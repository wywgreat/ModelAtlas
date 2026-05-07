const HUGGING_FACE_MODELS_API = "https://huggingface.co/api/models";
const CACHE_KEY = "open-model-impact-dashboard:v2";
const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_HANDLE = 12;

const GENERATIVE_PIPELINE_TAGS = new Set([
  "text-generation",
  "text2text-generation",
  "conversational",
  "image-text-to-text",
  "visual-question-answering",
  "image-to-text",
  "text-to-image",
  "text-to-video",
  "image-to-video",
  "video-text-to-text",
  "any-to-any",
]);

const FOUNDATION_FAMILY_KEYWORDS = [
  "gpt",
  "gpt-oss",
  "qwen",
  "qwq",
  "deepseek",
  "llama",
  "codellama",
  "glm",
  "chatglm",
  "minimax",
  "abab",
];

const GENERATIVE_DESCRIPTOR_KEYWORDS = [
  "omni",
  "instruct",
  "chat",
  "coder",
  "reasoner",
];

const NON_FOUNDATION_KEYWORDS = [
  "clip",
  "siglip",
  "vit",
  "dino",
  "sam",
  "bert",
  "roberta",
  "distilbert",
  "xlm-roberta",
  "mpnet",
  "embedding",
  "embeddings",
  "embed",
  "rerank",
  "reranker",
  "ranker",
  "reward",
  "classifier",
  "classification",
  "detector",
  "segmentation",
];

const NON_FOUNDATION_PIPELINE_TAGS = new Set([
  "feature-extraction",
  "sentence-similarity",
  "fill-mask",
  "token-classification",
  "text-classification",
  "image-classification",
  "zero-shot-image-classification",
  "object-detection",
  "depth-estimation",
  "image-segmentation",
  "automatic-speech-recognition",
  "audio-classification",
]);

const COMPANIES = [
  {
    id: "qwen",
    label: "Qwen",
    handles: ["Qwen"],
    color: "#16835b",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    handles: ["deepseek-ai"],
    color: "#d64f3d",
  },
  {
    id: "openai",
    label: "OpenAI",
    handles: ["openai"],
    color: "#202823",
  },
  {
    id: "llama",
    label: "Llama / Meta",
    handles: ["meta-llama"],
    color: "#2d6cdf",
  },
  {
    id: "glm",
    label: "GLM / Zhipu",
    handles: ["THUDM", "zai-org"],
    includeKeywords: ["glm", "chatglm"],
    color: "#bc8424",
  },
  {
    id: "minimax",
    label: "MiniMax",
    handles: ["MiniMaxAI"],
    color: "#1b8a9a",
  },
];

const state = {
  models: [],
  summaries: [],
  warnings: [],
  isLoading: false,
  lastUpdated: null,
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  exportButton: document.querySelector("#exportButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  lastUpdated: document.querySelector("#lastUpdated"),
  summaryGrid: document.querySelector("#summaryGrid"),
  allTimeChart: document.querySelector("#allTimeChart"),
  recentChart: document.querySelector("#recentChart"),
  scoreChart: document.querySelector("#scoreChart"),
  concentrationChart: document.querySelector("#concentrationChart"),
  timelineChart: document.querySelector("#timelineChart"),
  modelTable: document.querySelector("#modelTable"),
  companyFilter: document.querySelector("#companyFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate"),
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function init() {
  populateCompanyFilter();
  bindEvents();
  restoreCache();
  if (!state.models.length) {
    renderEmpty();
  }
  refreshData({ silent: Boolean(state.models.length) });
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshData({ silent: false }));
  elements.exportButton.addEventListener("click", exportCsv);
  elements.companyFilter.addEventListener("change", renderModelTable);
  elements.sortSelect.addEventListener("change", renderModelTable);
}

function populateCompanyFilter() {
  const options = COMPANIES.map((company) => {
    return `<option value="${company.id}">${escapeHtml(company.label)}</option>`;
  }).join("");
  elements.companyFilter.insertAdjacentHTML("beforeend", options);
}

function restoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cached?.models?.length) return;

    state.models = cached.models.filter(isGenerativeFoundationModel);
    state.lastUpdated = cached.lastUpdated;
    state.warnings = cached.warnings || [];
    recomputeAndRender();
    setStatus("ready", `已载入缓存数据，共 ${state.models.length} 个生成式大模型`);
  } catch (error) {
    console.warn("Failed to restore cache", error);
  }
}

async function refreshData({ silent }) {
  if (state.isLoading) return;
  state.isLoading = true;
  setLoading(true);
  setStatus("loading", silent ? "正在后台刷新 Hugging Face 数据" : "正在获取 Hugging Face 最新数据");

  try {
    const progress = createProgressReporter();
    const results = await Promise.all(
      COMPANIES.map((company) => fetchCompanyModels(company, progress)),
    );

    const seen = new Set();
    const models = results
      .flat()
      .filter((model) => {
        if (seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      })
      .sort((a, b) => b.downloadsAllTime - a.downloadsAllTime);

    state.models = models;
    state.lastUpdated = new Date().toISOString();
    state.warnings = collectWarnings(results);
    persistCache();
    recomputeAndRender();
    setStatus("ready", `更新完成，共获取 ${models.length} 个生成式大模型`);
  } catch (error) {
    console.error(error);
    setStatus("error", "数据更新失败，请稍后重试或检查网络连接");
    renderError(error);
  } finally {
    state.isLoading = false;
    setLoading(false);
  }
}

function createProgressReporter() {
  const totalHandles = COMPANIES.reduce((sum, company) => sum + company.handles.length, 0);
  let completed = 0;
  return (handle, count) => {
    completed += 1;
    setStatus("loading", `已获取 ${handle}：${count} 个模型（${completed}/${totalHandles}）`);
  };
}

async function fetchCompanyModels(company, reportProgress) {
  const batches = await Promise.all(
    company.handles.map(async (handle) => {
      const rawModels = await fetchHandleModels(handle);
      reportProgress(handle, rawModels.length);
      return rawModels
        .map((raw) => normalizeModel(raw, company, handle))
        .filter((model) => belongsToCompany(model, company))
        .filter(isGenerativeFoundationModel);
    }),
  );
  return batches.flat();
}

async function fetchHandleModels(handle) {
  try {
    return await fetchHandleModelsByMode(handle, "expand");
  } catch (error) {
    if (isRecoverableQueryError(error)) {
      return fetchHandleModelsByMode(handle, "full");
    }
    throw error;
  }
}

async function fetchHandleModelsByMode(handle, mode) {
  let nextUrl = buildModelsUrl(handle, mode);
  const models = [];
  let page = 0;

  while (nextUrl && page < MAX_PAGES_PER_HANDLE) {
    page += 1;
    const response = await fetchWithTimeout(nextUrl);
    if (!response.ok) {
      throw new Error(`${handle} 请求失败：HTTP ${response.status}`, {
        cause: { status: response.status, mode },
      });
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`${handle} 返回格式异常`);
    }

    models.push(...data);
    const linkHeader = response.headers.get("Link") || response.headers.get("link");
    nextUrl = parseNextLink(linkHeader);
  }

  return models;
}

function buildModelsUrl(handle, mode = "expand") {
  const url = new URL(HUGGING_FACE_MODELS_API);
  url.searchParams.set("author", handle);
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (mode === "full") {
    url.searchParams.set("full", "true");
  } else {
    [
      "author",
      "createdAt",
      "disabled",
      "downloads",
      "downloadsAllTime",
      "gated",
      "lastModified",
      "library_name",
      "likes",
      "pipeline_tag",
      "private",
      "tags",
    ].forEach((field) => url.searchParams.append("expand", field));
  }
  return url.toString();
}

async function fetchWithTimeout(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Hugging Face API 请求超时，请稍后重试。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isRecoverableQueryError(error) {
  const status = error.cause?.status;
  return status === 400 || status === 422;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function normalizeModel(raw, company, handle) {
  const id = raw.id || raw.modelId || raw._id || `${handle}/unknown`;
  const downloads30d = toNumber(raw.downloads);
  const downloadsAllTime = toNumber(raw.downloadsAllTime ?? raw.downloads_all_time ?? raw.downloads);
  const tags = Array.isArray(raw.tags) ? raw.tags : [];

  return {
    id,
    companyId: company.id,
    companyLabel: company.label,
    handle,
    url: `https://huggingface.co/${id}`,
    downloads30d,
    downloadsAllTime,
    likes: toNumber(raw.likes),
    createdAt: raw.createdAt || raw.created_at || null,
    lastModified: raw.lastModified || raw.last_modified || null,
    pipelineTag: raw.pipeline_tag || inferPipelineTag(tags),
    tags,
    isPrivate: Boolean(raw.private),
    isDisabled: Boolean(raw.disabled),
  };
}

function belongsToCompany(model, company) {
  if (model.isPrivate || model.isDisabled) return false;
  if (!company.includeKeywords?.length) return true;
  const searchable = `${model.id} ${model.pipelineTag} ${model.tags.join(" ")}`.toLowerCase();
  return company.includeKeywords.some((keyword) => searchable.includes(keyword));
}

function isGenerativeFoundationModel(model) {
  const searchable = `${model.id} ${model.pipelineTag} ${model.tags.join(" ")}`.toLowerCase();
  if (NON_FOUNDATION_KEYWORDS.some((keyword) => searchable.includes(keyword))) return false;
  if (NON_FOUNDATION_PIPELINE_TAGS.has(model.pipelineTag) && !hasFoundationFamilyKeyword(searchable)) return false;
  if (hasGenerativeModelKeyword(searchable)) return true;
  return GENERATIVE_PIPELINE_TAGS.has(model.pipelineTag);
}

function hasGenerativeModelKeyword(searchable) {
  return hasFoundationFamilyKeyword(searchable) || GENERATIVE_DESCRIPTOR_KEYWORDS.some((keyword) => searchable.includes(keyword));
}

function hasFoundationFamilyKeyword(searchable) {
  return FOUNDATION_FAMILY_KEYWORDS.some((keyword) => searchable.includes(keyword));
}

function inferPipelineTag(tags) {
  const taskTags = [
    "text-generation",
    "image-text-to-text",
    "text-to-image",
    "text2text-generation",
    "visual-question-answering",
    "image-to-text",
    "text-to-video",
    "image-to-video",
    "video-text-to-text",
    "any-to-any",
  ];
  return tags.find((tag) => taskTags.includes(tag)) || "unknown";
}

function recomputeAndRender() {
  state.summaries = computeSummaries(state.models);
  renderAll();
  updateLastUpdated();
}

function computeSummaries(models) {
  const summaries = COMPANIES.map((company) => {
    const companyModels = models.filter((model) => model.companyId === company.id);
    const sortedByAllTime = [...companyModels].sort((a, b) => b.downloadsAllTime - a.downloadsAllTime);
    const allTime = sumBy(companyModels, "downloadsAllTime");
    const recent = sumBy(companyModels, "downloads30d");
    const likes = sumBy(companyModels, "likes");
    const topModel = sortedByAllTime[0] || null;
    const topFiveDownloads = sortedByAllTime.slice(0, 5).reduce((sum, model) => sum + model.downloadsAllTime, 0);
    const releaseYears = countByYear(companyModels);

    return {
      ...company,
      models: companyModels,
      modelCount: companyModels.length,
      allTime,
      recent,
      likes,
      topModel,
      topShare: allTime ? (topModel?.downloadsAllTime || 0) / allTime : 0,
      topFiveShare: allTime ? topFiveDownloads / allTime : 0,
      momentum: allTime ? recent / allTime : 0,
      releaseYears,
    };
  });

  const maxAllTime = Math.max(...summaries.map((item) => item.allTime), 1);
  const maxRecent = Math.max(...summaries.map((item) => item.recent), 1);
  const maxCount = Math.max(...summaries.map((item) => item.modelCount), 1);
  const maxLikes = Math.max(...summaries.map((item) => item.likes), 1);

  return summaries
    .map((summary) => {
      const score =
        100 *
        (0.45 * (summary.allTime / maxAllTime) +
          0.3 * (summary.recent / maxRecent) +
          0.15 * (summary.modelCount / maxCount) +
          0.1 * (summary.likes / maxLikes));
      return { ...summary, score };
    })
    .sort((a, b) => b.allTime - a.allTime);
}

function renderAll() {
  renderSummary();
  renderBarChart(elements.allTimeChart, state.summaries, {
    valueKey: "allTime",
    label: "累计下载",
  });
  renderBarChart(elements.recentChart, state.summaries, {
    valueKey: "recent",
    label: "近 30 天",
  });
  renderScoreChart();
  renderConcentrationChart();
  renderTimelineChart();
  renderModelTable();
}

function renderSummary() {
  const totalAllTime = sumBy(state.models, "downloadsAllTime");
  const totalRecent = sumBy(state.models, "downloads30d");
  const totalLikes = sumBy(state.models, "likes");
  const topCompany = [...state.summaries].sort((a, b) => b.allTime - a.allTime)[0];
  const topMomentum = [...state.summaries].sort((a, b) => b.recent - a.recent)[0];

  const cards = [
    {
      label: "累计下载总量",
      value: formatCompact(totalAllTime),
      note: `${state.models.length} 个生成式大模型`,
      chip: "All time",
    },
    {
      label: "近 30 天下载",
      value: formatCompact(totalRecent),
      note: topMomentum ? `${topMomentum.label} 当前热度最高` : "等待数据",
      chip: "30 days",
    },
    {
      label: "社区点赞",
      value: formatCompact(totalLikes),
      note: "作为社区兴趣的辅助信号",
      chip: "Likes",
    },
    {
      label: "领先公司",
      value: topCompany?.label || "-",
      note: topCompany ? `${formatCompact(topCompany.allTime)} 累计下载` : "等待数据",
      chip: "Leader",
    },
  ];

  elements.summaryGrid.innerHTML = cards
    .map((card) => {
      return `
        <div class="metric-card">
          <div class="metric-label">
            <span>${escapeHtml(card.label)}</span>
            <span class="metric-chip">${escapeHtml(card.chip)}</span>
          </div>
          <strong>${escapeHtml(card.value)}</strong>
          <span>${escapeHtml(card.note)}</span>
        </div>
      `;
    })
    .join("");
}

function renderBarChart(container, rows, config) {
  if (!rows.length) {
    renderEmptyInto(container);
    return;
  }

  const maxValue = Math.max(...rows.map((row) => row[config.valueKey]), 1);
  container.innerHTML = `
    <div class="bar-list">
      ${rows
        .map((row) => {
          const width = Math.max(0.5, (row[config.valueKey] / maxValue) * 100);
          return `
            <div class="bar-row">
              <div class="bar-name">${escapeHtml(row.label)}</div>
              <div class="bar-track" title="${escapeHtml(row.label)} ${escapeHtml(config.label)} ${formatNumber(row[config.valueKey])}">
                <div class="bar-fill" style="width:${width}%; background:${row.color}"></div>
              </div>
              <div class="bar-value">${formatCompact(row[config.valueKey])}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderScoreChart() {
  if (!state.summaries.length) {
    renderEmptyInto(elements.scoreChart);
    return;
  }

  const rows = [...state.summaries].sort((a, b) => b.score - a.score);
  elements.scoreChart.innerHTML = `
    <div class="score-list">
      ${rows
        .map((row) => {
          return `
            <div class="score-row">
              <strong>${escapeHtml(row.label)}</strong>
              <div class="score-track" title="${escapeHtml(row.label)} 综合影响力 ${formatPercent(row.score / 100)}">
                <div class="score-fill" style="width:${row.score}%; background:${row.color}"></div>
              </div>
              <span>${Math.round(row.score)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderConcentrationChart() {
  if (!state.summaries.length) {
    renderEmptyInto(elements.concentrationChart);
    return;
  }

  const rows = [...state.summaries].sort((a, b) => b.topFiveShare - a.topFiveShare);
  elements.concentrationChart.innerHTML = `
    <div class="mini-table">
      ${rows
        .map((row) => {
          const topModel = row.topModel?.id.split("/").pop() || "暂无模型";
          return `
            <div class="mini-row">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span class="tag" title="${escapeHtml(topModel)}">Top: ${escapeHtml(topModel)}</span>
              </div>
              <span>${formatPercent(row.topFiveShare)} / Top 5</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTimelineChart() {
  if (!state.summaries.length) {
    renderEmptyInto(elements.timelineChart);
    return;
  }

  const years = Array.from(
    new Set(
      state.summaries.flatMap((summary) => Object.keys(summary.releaseYears)),
    ),
  )
    .map(Number)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!years.length) {
    renderEmptyInto(elements.timelineChart);
    return;
  }

  const maxYearCount = Math.max(
    ...years.map((year) => state.summaries.reduce((sum, summary) => sum + (summary.releaseYears[year] || 0), 0)),
    1,
  );

  elements.timelineChart.innerHTML = `
    <div class="timeline">
      ${years
        .map((year) => {
          const bars = state.summaries
            .filter((summary) => summary.releaseYears[year])
            .map((summary) => {
              const count = summary.releaseYears[year];
              const height = Math.max(3, (count / maxYearCount) * 170);
              return `
                <div
                  class="year-segment"
                  title="${escapeHtml(summary.label)} ${year}: ${count} 个模型"
                  style="height:${height}px; background:${summary.color}"
                ></div>
              `;
            })
            .join("");
          return `
            <div class="year-col">
              <div class="year-stack">${bars}</div>
              <div class="year-label">${year}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderModelTable() {
  const companyId = elements.companyFilter.value;
  const sortKey = elements.sortSelect.value;
  const models = state.models
    .filter((model) => companyId === "all" || model.companyId === companyId)
    .sort((a, b) => compareModels(a, b, sortKey))
    .slice(0, 250);

  if (!models.length) {
    elements.modelTable.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <strong>暂无模型明细</strong>
            <span>换一个筛选条件，或点击“数据更新”。</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  elements.modelTable.innerHTML = models
    .map((model) => {
      return `
        <tr>
          <td><a href="${model.url}" target="_blank" rel="noreferrer">${escapeHtml(model.id)}</a></td>
          <td>${escapeHtml(model.companyLabel)}</td>
          <td><span class="tag">${escapeHtml(model.pipelineTag)}</span></td>
          <td>${formatNumber(model.downloadsAllTime)}</td>
          <td>${formatNumber(model.downloads30d)}</td>
          <td>${formatNumber(model.likes)}</td>
          <td>${formatDate(model.createdAt)}</td>
        </tr>
      `;
    })
    .join("");
}

function compareModels(a, b, sortKey) {
  if (sortKey === "recent") return b.downloads30d - a.downloads30d;
  if (sortKey === "likes") return b.likes - a.likes;
  if (sortKey === "createdAt") return timestamp(b.createdAt) - timestamp(a.createdAt);
  return b.downloadsAllTime - a.downloadsAllTime;
}

function renderEmpty() {
  [
    elements.summaryGrid,
    elements.allTimeChart,
    elements.recentChart,
    elements.scoreChart,
    elements.concentrationChart,
    elements.timelineChart,
  ].forEach(renderEmptyInto);
}

function renderEmptyInto(container) {
  container.innerHTML = elements.emptyStateTemplate.innerHTML;
}

function renderError(error) {
  if (state.models.length) return;
  elements.allTimeChart.innerHTML = `
    <div class="error-box">
      <strong>无法获取数据</strong><br />
      ${escapeHtml(error.message || "未知错误")}。Hugging Face API 可能短暂不可用，或当前浏览器网络受限。
    </div>
  `;
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.exportButton.disabled = isLoading || !state.models.length;
  elements.refreshButton.querySelector("span[aria-hidden='true']").textContent = isLoading ? "…" : "↻";
}

function setStatus(type, text) {
  elements.statusDot.className = `status-dot ${type}`;
  elements.statusText.textContent = text;
}

function updateLastUpdated() {
  if (!state.lastUpdated) {
    elements.lastUpdated.textContent = "尚未更新";
    return;
  }
  elements.lastUpdated.textContent = `最近更新：${formatDateTime(state.lastUpdated)}`;
}

function persistCache() {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      models: state.models,
      lastUpdated: state.lastUpdated,
      warnings: state.warnings,
    }),
  );
}

function collectWarnings(resultSets) {
  const warnings = [];
  resultSets.flat().forEach((model) => {
    if (!model.downloadsAllTime && model.downloads30d) {
      warnings.push(`${model.id} 缺少累计下载量，已使用近 30 天下载量回退。`);
    }
  });
  return warnings;
}

function exportCsv() {
  if (!state.models.length) return;
  const header = [
    "model_id",
    "company",
    "hf_author",
    "pipeline_tag",
    "downloads_all_time",
    "downloads_30d",
    "likes",
    "created_at",
    "last_modified",
    "url",
  ];
  const rows = state.models.map((model) => [
    model.id,
    model.companyLabel,
    model.handle,
    model.pipelineTag,
    model.downloadsAllTime,
    model.downloads30d,
    model.likes,
    model.createdAt || "",
    model.lastModified || "",
    model.url,
  ]);
  const csv = [header, ...rows].map(toCsvRow).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `open-model-impact-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function toCsvRow(row) {
  return row
    .map((value) => {
      const text = String(value ?? "");
      if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
      }
      return text;
    })
    .join(",");
}

function countByYear(models) {
  return models.reduce((acc, model) => {
    const date = model.createdAt ? new Date(model.createdAt) : null;
    const year = date && !Number.isNaN(date.valueOf()) ? date.getFullYear() : null;
    if (year) acc[year] = (acc[year] || 0) + 1;
    return acc;
  }, {});
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + toNumber(item[key]), 0);
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.valueOf() : 0;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return numberFormatter.format(toNumber(value));
}

function formatCompact(value) {
  return compactFormatter.format(toNumber(value));
}

function formatPercent(value) {
  return `${percentFormatter.format(toNumber(value) * 100)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "-" : dateFormatter.format(date);
}

function formatDateTime(value) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "尚未更新";
  return `${dateFormatter.format(date)} ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();
