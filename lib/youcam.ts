```ts
/**
 * YouCam API client (Perfect Corp.)
 * -----------------------------------------------------------------------
 * Skin Analysis flow:
 *
 *   1. Validate image dimensions locally
 *   2. Choose HD or SD automatically
 *   3. File API -> get pre-signed upload URL + file id
 *   4. Upload the original image
 *   5. Task API -> submit Skin Analysis
 *   6. Poll until complete
 *   7. Parse YouCam's JSON response
 *   8. Convert severity scores into app-friendly health scores
 *
 * Image requirements from Perfect Corp:
 *   - JPEG / PNG
 *   - Maximum file size: 10 MB
 *   - SD: short side >= 480 px
 *   - HD: short side >= 1080 px
 *   - Long side <= 4096 px
 *   - dst_actions must be entirely SD OR entirely HD
 *
 * DEMO_MODE:
 *   If YOUCAM_API_KEY is not configured, the client returns realistic
 *   mock metrics so the complete product flow can still be demonstrated.
 */

const BASE_URL =
  process.env.YOUCAM_BASE_URL || "https://yce-api-01.perfectcorp.com";

const API_KEY = process.env.YOUCAM_API_KEY;

export const DEMO_MODE = !API_KEY;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const SD_MIN_SHORT_SIDE = 480;
const HD_MIN_SHORT_SIDE = 1080;
const MAX_LONG_SIDE = 4096;

const MAX_POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 1500;

export type AnalysisMode = "hd" | "sd" | "demo";

export type SkinMetric = {
  key: string;
  label: string;

  /**
   * App-facing score.
   *
   * 0   = poor / higher concern
   * 100 = healthier / lower concern
   *
   * This is derived from YouCam's severity score.
   */
  score: number;

  /**
   * Original YouCam severity score when available.
   *
   * 0   = low severity
   * 100 = high severity
   */
  severity?: number;

  note: string;
};

export type SkinAnalysisResult = {
  metrics: SkinMetric[];
  demo: boolean;
  mode: AnalysisMode;

  /**
   * Useful for debugging / displaying the selected API mode.
   */
  image?: {
    width: number;
    height: number;
    shortSide: number;
    longSide: number;
  };
};

type ImageDimensions = {
  width: number;
  height: number;
};

type AnalysisConfiguration = {
  mode: "hd" | "sd";
  actions: string[];
};

type MetricDefinition = {
  key: string;
  label: string;
  hdAction: string;
  sdAction: string;
};

/**
 * The eight concerns used by the application.
 *
 * IMPORTANT:
 * HD and SD actions are deliberately kept separate.
 * YouCam does not allow mixing them in one request.
 */
const METRICS: MetricDefinition[] = [
  {
    key: "moisture",
    label: "Moisture",
    hdAction: "hd_moisture",
    sdAction: "moisture",
  },
  {
    key: "oiliness",
    label: "Oiliness",
    hdAction: "hd_oiliness",
    sdAction: "oiliness",
  },
  {
    key: "redness",
    label: "Redness",
    hdAction: "hd_redness",
    sdAction: "redness",
  },
  {
    key: "acne",
    label: "Acne",
    hdAction: "hd_acne",
    sdAction: "acne",
  },
  {
    key: "spots",
    label: "Spots",
    hdAction: "hd_age_spot",
    sdAction: "age_spot",
  },
  {
    key: "wrinkles",
    label: "Wrinkles",
    hdAction: "hd_wrinkle",
    sdAction: "wrinkle",
  },
  {
    key: "texture",
    label: "Texture",
    hdAction: "hd_texture",
    sdAction: "texture",
  },
  {
    key: "dark_circles",
    label: "Dark Circles",
    hdAction: "hd_dark_circle",
    sdAction: "dark_circle",
  },
];

/* ---------------------------------------------------------------------- */
/* Authentication                                                         */
/* ---------------------------------------------------------------------- */

function authHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  if (!API_KEY) {
    throw new Error("YOUCAM_API_KEY is not configured");
  }

  return {
    Authorization: `Bearer ${API_KEY}`,
    ...extra,
  };
}

/* ---------------------------------------------------------------------- */
/* Image validation                                                        */
/* ---------------------------------------------------------------------- */

/**
 * Read PNG dimensions without external dependencies.
 */
function getPngDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 24) {
    throw new Error("Invalid PNG: file is too small.");
  }

  const signature = buffer.subarray(0, 8);

  const PNG_SIGNATURE = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);

  if (!signature.equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature.");
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (!width || !height) {
    throw new Error("PNG contains invalid dimensions.");
  }

  return {
    width,
    height,
  };
}

/**
 * Read JPEG dimensions without external dependencies.
 *
 * JPEG stores dimensions in SOF markers.
 */
function getJpegDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 4) {
    throw new Error("Invalid JPEG: file is too small.");
  }

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Invalid JPEG signature.");
  }

  let offset = 2;

  while (offset < buffer.length) {
    /**
     * Find the next marker.
     */
    while (offset < buffer.length && buffer[offset] !== 0xff) {
      offset++;
    }

    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset++;
    }

    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset];
    offset++;

    /**
     * Standalone JPEG markers do not contain a length.
     */
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);

    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    /**
     * Start Of Frame markers that contain width/height.
     */
    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSofMarker) {
      if (segmentLength < 7) {
        throw new Error("Invalid JPEG SOF segment.");
      }

      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);

      if (!width || !height) {
        throw new Error("JPEG contains invalid dimensions.");
      }

      return {
        width,
        height,
      };
    }

    offset += segmentLength;
  }

  throw new Error(
    "Could not determine JPEG dimensions. Please upload a valid JPEG image.",
  );
}

/**
 * Detect image format and dimensions.
 */
function getImageDimensions(
  imageBuffer: Buffer,
  contentType: string,
): ImageDimensions {
  const normalizedContentType = contentType.toLowerCase().split(";")[0].trim();

  if (normalizedContentType === "image/png") {
    return getPngDimensions(imageBuffer);
  }

  if (
    normalizedContentType === "image/jpeg" ||
    normalizedContentType === "image/jpg"
  ) {
    return getJpegDimensions(imageBuffer);
  }

  /**
   * Fall back to magic-byte detection because some browsers/proxies
   * occasionally provide an incorrect content type.
   */

  if (
    imageBuffer.length >= 8 &&
    imageBuffer.subarray(0, 8).equals(
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
    )
  ) {
    return getPngDimensions(imageBuffer);
  }

  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0xff &&
    imageBuffer[1] === 0xd8
  ) {
    return getJpegDimensions(imageBuffer);
  }

  throw new Error(
    "Unsupported image format. Please upload a JPEG or PNG image.",
  );
}

/**
 * Validate dimensions and decide whether HD or SD should be used.
 */
function chooseAnalysisMode(
  dimensions: ImageDimensions,
): "hd" | "sd" {
  const shortSide = Math.min(dimensions.width, dimensions.height);
  const longSide = Math.max(dimensions.width, dimensions.height);

  if (longSide > MAX_LONG_SIDE) {
    throw new Error(
      `Image is too large for YouCam. The longest side is ${longSide}px, but the maximum is ${MAX_LONG_SIDE}px.`,
    );
  }

  if (shortSide >= HD_MIN_SHORT_SIDE) {
    return "hd";
  }

  if (shortSide >= SD_MIN_SHORT_SIDE) {
    return "sd";
  }

  throw new Error(
    `Image resolution is too low for skin analysis. ` +
      `The shorter side is ${shortSide}px. ` +
      `Please upload a photo with at least ${SD_MIN_SHORT_SIDE}px ` +
      `on the shorter side.`,
  );
}

/* ---------------------------------------------------------------------- */
/* API action selection                                                    */
/* ---------------------------------------------------------------------- */

function getAnalysisConfiguration(
  mode: "hd" | "sd",
): AnalysisConfiguration {
  if (mode === "hd") {
    return {
      mode: "hd",
      actions: METRICS.map((metric) => metric.hdAction),
    };
  }

  return {
    mode: "sd",
    actions: METRICS.map((metric) => metric.sdAction),
  };
}

/* ---------------------------------------------------------------------- */
/* File API                                                                */
/* ---------------------------------------------------------------------- */

async function uploadImage(
  imageBuffer: Buffer,
  contentType: string,
): Promise<string> {
  if (imageBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Image is too large. Maximum supported file size is 10 MB.`,
    );
  }

  const ext =
    contentType.toLowerCase().includes("png")
      ? "png"
      : "jpg";

  /**
   * Step 1:
   * Ask YouCam for a pre-signed upload URL.
   */
  const fileRes = await fetch(
    `${BASE_URL}/s2s/v2.0/file/skin-analysis`,
    {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        files: [
          {
            content_type: contentType,
            file_name: `skinmoment-${Date.now()}.${ext}`,
            file_size: imageBuffer.byteLength,
          },
        ],
      }),
    },
  );

  if (!fileRes.ok) {
    const body = await fileRes.text();

    throw new Error(
      `YouCam file init failed: ${fileRes.status} ${body}`,
    );
  }

  const fileData = await fileRes.json();

  const fileEntry =
    fileData?.data?.files?.[0] ??
    fileData?.files?.[0];

  const uploadRequest =
    fileEntry?.requests?.[0];

  const fileId =
    fileEntry?.file_id;

  if (!uploadRequest?.url || !fileId) {
    throw new Error(
      "YouCam file init returned an unexpected response: missing upload URL or file_id.",
    );
  }

  /**
   * Step 2:
   * Upload the actual bytes to the signed URL.
   */
  const uploadHeaders: Record<string, string> =
    uploadRequest.headers ?? {
      "Content-Type": contentType,
    };

  const putRes = await fetch(uploadRequest.url, {
    method: uploadRequest.method || "PUT",
    headers: uploadHeaders,
    body: imageBuffer,
  });

  if (!putRes.ok) {
    const body = await putRes.text();

    throw new Error(
      `YouCam image upload failed: ${putRes.status} ${body}`,
    );
  }

  return fileId;
}

/* ---------------------------------------------------------------------- */
/* Task submission                                                         */
/* ---------------------------------------------------------------------- */

async function submitSkinAnalysis(
  fileId: string,
  configuration: AnalysisConfiguration,
): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/s2s/v2.0/task/skin-analysis`,
    {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        src_file_id: fileId,

        /**
         * IMPORTANT:
         * These are ALL HD or ALL SD.
         * Never mix them.
         */
        dst_actions: configuration.actions,

        /**
         * Ask for JSON rather than ZIP.
         */
        format: "json",
      }),
    },
  );

  const responseText = await res.text();

  if (!res.ok) {
    throw new Error(
      `YouCam task submit failed: ${res.status} ${responseText}`,
    );
  }

  let data: any;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      "YouCam task submit returned invalid JSON.",
    );
  }

  const taskId =
    data?.data?.task_id ??
    data?.task_id;

  if (!taskId) {
    throw new Error(
      "YouCam task submit did not return a task_id.",
    );
  }

  return taskId;
}

/* ---------------------------------------------------------------------- */
/* Polling                                                                 */
/* ---------------------------------------------------------------------- */

async function pollTask(taskId: string): Promise<any> {
  for (
    let attempt = 0;
    attempt < MAX_POLL_ATTEMPTS;
    attempt++
  ) {
    const res = await fetch(
      `${BASE_URL}/s2s/v2.0/task/skin-analysis/${taskId}`,
      {
        headers: authHeaders(),
      },
    );

    const responseText = await res.text();

    if (!res.ok) {
      throw new Error(
        `YouCam task poll failed: ${res.status} ${responseText}`,
      );
    }

    let data: any;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        "YouCam task poll returned invalid JSON.",
      );
    }

    const payload = data?.data ?? data;

    const status =
      payload?.task_status ??
      data?.task_status ??
      payload?.status ??
      data?.status;

    const normalizedStatus =
      typeof status === "string"
        ? status.toLowerCase()
        : status;

    if (
      normalizedStatus === "success" ||
      normalizedStatus === "completed" ||
      normalizedStatus === "complete"
    ) {
      return payload;
    }

    if (
      normalizedStatus === "error" ||
      normalizedStatus === "failed" ||
      normalizedStatus === "failure"
    ) {
      const errorMessage =
        payload?.error_message ??
        payload?.message ??
        data?.error_message ??
        "YouCam skin analysis task failed.";

      throw new Error(errorMessage);
    }

    /**
     * Still processing.
     */
    await new Promise((resolve) =>
      setTimeout(resolve, POLL_DELAY_MS),
    );
  }

  throw new Error(
    "YouCam skin analysis timed out. Please try again.",
  );
}

/* ---------------------------------------------------------------------- */
/* Score extraction                                                        */
/* ---------------------------------------------------------------------- */

/**
 * Convert arbitrary numeric-looking values into a number.
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Extract a severity/ui score from one result object.
 *
 * YouCam responses can vary by API/account/version, so we deliberately
 * support several structures.
 */
function extractScoreValue(
  value: any,
): number | undefined {
  if (value == null) {
    return undefined;
  }

  /**
   * Direct number.
   */
  const direct = toNumber(value);

  if (direct !== undefined) {
    return direct;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  /**
   * Common direct score fields.
   */
  const directFields = [
    "severity_score",
    "severity",
    "score",
    "ui_score",
    "raw_score",
    "value",
  ];

  for (const field of directFields) {
    const number = toNumber(value[field]);

    if (number !== undefined) {
      return number;
    }
  }

  /**
   * Nested whole-face result.
   */
  if (value.whole) {
    const wholeScore = extractScoreValue(value.whole);

    if (wholeScore !== undefined) {
      return wholeScore;
    }
  }

  /**
   * Some responses nest the actual score under result/data.
   */
  if (value.result) {
    const resultScore = extractScoreValue(value.result);

    if (resultScore !== undefined) {
      return resultScore;
    }
  }

  if (value.data) {
    const dataScore = extractScoreValue(value.data);

    if (dataScore !== undefined) {
      return dataScore;
    }
  }

  return undefined;
}

/**
 * Search a result payload for one metric.
 *
 * Supports:
 *
 * 1. output array:
 *    {
 *      output: [
 *        {
 *          type: "hd_acne",
 *          ui_score: 32,
 *          raw_score: 0.32
 *        }
 *      ]
 *    }
 *
 * 2. keyed object:
 *    {
 *      hd_acne: {
 *        whole: {
 *          ui_score: 32
 *        }
 *      }
 *    }
 */
function extractMetricSeverity(
  results: any,
  metric: MetricDefinition,
  mode: "hd" | "sd",
): number | undefined {
  const action =
    mode === "hd"
      ? metric.hdAction
      : metric.sdAction;

  const possibleNames = new Set([
    action,
    metric.key,
    metric.hdAction,
    metric.sdAction,
  ]);

  /**
   * Search arrays recursively.
   */
  function searchArray(array: any[]): number | undefined {
    for (const item of array) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const type =
        item.type ??
        item.action ??
        item.name ??
        item.key;

      if (
        typeof type === "string" &&
        possibleNames.has(type)
      ) {
        const score = extractScoreValue(item);

        if (score !== undefined) {
          return score;
        }
      }

      /**
       * Some APIs may use a concern field.
       */
      const concern =
        item.concern ??
        item.metric ??
        item.metric_name;

      if (
        typeof concern === "string" &&
        possibleNames.has(concern)
      ) {
        const score = extractScoreValue(item);

        if (score !== undefined) {
          return score;
        }
      }
    }

    return undefined;
  }

  /**
   * First look at common output arrays.
   */
  const arrays = [
    results?.output,
    results?.results,
    results?.data,
    results?.items,
  ];

  for (const array of arrays) {
    if (Array.isArray(array)) {
      const score = searchArray(array);

      if (score !== undefined) {
        return score;
      }
    }
  }

  /**
   * Then inspect keyed objects.
   */
  for (const name of possibleNames) {
    const entry = results?.[name];

    if (entry !== undefined) {
      const score = extractScoreValue(entry);

      if (score !== undefined) {
        return score;
      }
    }
  }

  /**
   * Finally recursively search nested objects.
   *
   * This makes the parser more tolerant of account/version differences.
   */
  function recursiveSearch(
    value: any,
    depth: number,
  ): number | undefined {
    if (depth > 6 || value == null) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return searchArray(value);
    }

    if (typeof value !== "object") {
      return undefined;
    }

    for (const [key, child] of Object.entries(value)) {
      if (possibleNames.has(key)) {
        const score = extractScoreValue(child);

        if (score !== undefined) {
          return score;
        }
      }
    }

    for (const child of Object.values(value)) {
      const score = recursiveSearch(
        child,
        depth + 1,
      );

      if (score !== undefined) {
        return score;
      }
    }

    return undefined;
  }

  return recursiveSearch(results, 0);
}

/* ---------------------------------------------------------------------- */
/* Score normalization                                                     */
/* ---------------------------------------------------------------------- */

/**
 * YouCam documents these as severity scores:
 *
 *   0   = lower severity
 *   100 = higher severity
 *
 * Your application's UI uses the opposite interpretation:
 *
 *   0   = poor
 *   100 = healthier
 *
 * Therefore:
 *
 *   healthScore = 100 - severity
 *
 * We clamp everything to 0-100.
 */
function severityToHealthScore(
  severity: number,
): number {
  const normalized = Math.max(
    0,
    Math.min(100, severity),
  );

  return Math.round(100 - normalized);
}

function describeScore(
  label: string,
  healthScore: number,
): string {
  if (healthScore >= 80) {
    return `${label} is in great shape right now.`;
  }

  if (healthScore >= 60) {
    return `${label} looks generally healthy, with some room to improve.`;
  }

  if (healthScore >= 40) {
    return `${label} shows moderate concern — worth actively addressing.`;
  }

  return `${label} is one of your higher-priority concerns right now.`;
}

/**
 * Normalize the complete YouCam response.
 *
 * IMPORTANT:
 * Missing values are NOT replaced with a fake 70.
 */
function normaliseScores(
  raw: any,
  mode: "hd" | "sd",
): SkinMetric[] {
  /**
   * Different response versions may wrap results differently.
   */
  const results =
    raw?.results ??
    raw?.data?.results ??
    raw?.output ??
    raw?.data ??
    raw;

  return METRICS.map((metric) => {
    const severity =
      extractMetricSeverity(
        results,
        metric,
        mode,
      );

    /**
     * If YouCam didn't return a metric, don't manufacture a score.
     *
     * We use 0 health score as a conservative display fallback,
     * but the note explicitly tells the UI that the value is unavailable.
     */
    if (severity === undefined) {
      return {
        key: metric.key,
        label: metric.label,
        score: 0,
        note: `${metric.label} analysis was not returned by YouCam.`,
      };
    }

    const healthScore =
      severityToHealthScore(severity);

    return {
      key: metric.key,
      label: metric.label,
      score: healthScore,
      severity: Math.round(
        Math.max(0, Math.min(100, severity)),
      ),
      note: describeScore(
        metric.label,
        healthScore,
      ),
    };
  });
}

/* ---------------------------------------------------------------------- */
/* Demo mode                                                               */
/* ---------------------------------------------------------------------- */

function generateDemoMetrics(): SkinMetric[] {
  return METRICS.map(
    ({ key, label }) => {
      /**
       * Generate a severity value first, because that matches
       * the semantics of the real API.
       */
      const severity = Math.round(
        10 + Math.random() * 55,
      );

      const score =
        severityToHealthScore(severity);

      return {
        key,
        label,
        score,
        severity,
        note: describeScore(label, score),
      };
    },
  );
}

/* ---------------------------------------------------------------------- */
/* HD -> SD fallback                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Some images may technically satisfy our local HD dimension check
 * but still be rejected by the remote service.
 *
 * In that case, we retry with SD.
 *
 * We only do this after an HD submission failure.
 */
function shouldRetryAsSd(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  const dimensionKeywords = [
    "1080",
    "resolution",
    "dimension",
    "image size",
    "image resolution",
    "short side",
    "invalid image",
    "photo size",
  ];

  return dimensionKeywords.some(
    (keyword) =>
      message.includes(keyword),
  );
}

/* ---------------------------------------------------------------------- */
/* Main public function                                                    */
/* ---------------------------------------------------------------------- */

export async function analyzeSkin(
  imageBuffer: Buffer,
  contentType: string,
): Promise<SkinAnalysisResult> {
  /**
   * ---------------------------------------------------------------
   * DEMO MODE
   * ---------------------------------------------------------------
   */
  if (DEMO_MODE) {
    await new Promise((resolve) =>
      setTimeout(resolve, 1200),
    );

    return {
      metrics: generateDemoMetrics(),
      demo: true,
      mode: "demo",
    };
  }

  /**
   * ---------------------------------------------------------------
   * LOCAL VALIDATION
   * ---------------------------------------------------------------
   */

  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error(
      "Invalid image data.",
    );
  }

  if (imageBuffer.length === 0) {
    throw new Error(
      "The uploaded image is empty.",
    );
  }

  if (imageBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      "Image is too large. Maximum supported size is 10 MB.",
    );
  }

  const dimensions =
    getImageDimensions(
      imageBuffer,
      contentType,
    );

  const shortSide =
    Math.min(
      dimensions.width,
      dimensions.height,
    );

  const longSide =
    Math.max(
      dimensions.width,
      dimensions.height,
    );

  /**
   * Decide HD or SD before calling YouCam.
   */
  let mode =
    chooseAnalysisMode(dimensions);

  const imageInfo = {
    width: dimensions.width,
    height: dimensions.height,
    shortSide,
    longSide,
  };

  /**
   * ---------------------------------------------------------------
   * UPLOAD
   * ---------------------------------------------------------------
   *
   * Upload only once.
   *
   * The same file_id can then be submitted as HD or SD.
   */
  const fileId =
    await uploadImage(
      imageBuffer,
      contentType,
    );

  /**
   * ---------------------------------------------------------------
   * FIRST ATTEMPT
   * ---------------------------------------------------------------
   */

  try {
    const configuration =
      getAnalysisConfiguration(mode);

    const taskId =
      await submitSkinAnalysis(
        fileId,
        configuration,
      );

    const rawResult =
      await pollTask(taskId);

    return {
      metrics: normaliseScores(
        rawResult,
        mode,
      ),
      demo: false,
      mode,
      image: imageInfo,
    };
  } catch (error) {
    /**
     * -------------------------------------------------------------
     * HD -> SD FALLBACK
     * -------------------------------------------------------------
     *
     * Only downgrade when:
     *
     *   1. We originally selected HD
     *   2. The remote error looks like an image/resolution issue
     *
     * We do NOT blindly retry every HD error as SD.
     */
    if (
      mode !== "hd" ||
      !shouldRetryAsSd(error)
    ) {
      throw error;
    }

    mode = "sd";

    const sdConfiguration =
      getAnalysisConfiguration("sd");

    const taskId =
      await submitSkinAnalysis(
        fileId,
        sdConfiguration,
      );

    const rawResult =
      await pollTask(taskId);

    return {
      metrics: normaliseScores(
        rawResult,
        "sd",
      ),
      demo: false,
      mode: "sd",
      image: imageInfo,
    };
  }
}
```
