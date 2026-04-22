const refreshBtn = document.getElementById("refreshBtn");
const statusNode = document.getElementById("status");
const summaryBody = document.querySelector("#summaryTable tbody");
const topDownloadsBody = document.querySelector("#topDownloadsTable tbody");
const topLikesBody = document.querySelector("#topLikesTable tbody");
const recordCountNode = document.getElementById("recordCount");
const errorsNode = document.getElementById("errors");

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("zh-CN") : "-");

function fillTable(tbody, rows, columns) {
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = row[c] ?? "-";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderSummary(summary) {
  fillTable(
    summaryBody,
    summary.map((row) => ({
      ...row,
      downloads_sum: fmt(row.downloads_sum),
      downloads_avg: fmt(row.downloads_avg),
      likes_sum: fmt(row.likes_sum),
      likes_avg: fmt(row.likes_avg),
    })),
    ["source", "family", "model_count", "downloads_sum", "downloads_avg", "likes_sum", "likes_avg"]
  );
}

function renderTopTables(meta) {
  fillTable(
    topDownloadsBody,
    meta.top_downloads.map((r) => ({ ...r, downloads: fmt(r.downloads) })),
    ["model_id", "source", "family", "downloads"]
  );

  fillTable(
    topLikesBody,
    meta.top_likes.map((r) => ({ ...r, likes: fmt(r.likes) })),
    ["model_id", "source", "family", "likes"]
  );
}

function renderCharts(summary) {
  const x = summary.map((r) => `${r.family}@${r.source}`);
  const downloads = summary.map((r) => r.downloads_sum || 0);
  const likes = summary.map((r) => r.likes_sum || 0);

  Plotly.newPlot(
    "downloadsChart",
    [{ x, y: downloads, type: "bar", marker: { color: "#4f46e5" } }],
    { margin: { t: 10 }, yaxis: { title: "Downloads" } },
    { responsive: true }
  );

  Plotly.newPlot(
    "likesChart",
    [{ x, y: likes, type: "bar", marker: { color: "#16a34a" } }],
    { margin: { t: 10 }, yaxis: { title: "Likes" } },
    { responsive: true }
  );
}

async function refresh() {
  statusNode.textContent = "拉取中，请稍候...";
  refreshBtn.disabled = true;

  try {
    const res = await fetch("/api/models/refresh");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await res.json();

    renderSummary(payload.meta.summary);
    renderTopTables(payload.meta);
    renderCharts(payload.meta.summary);

    recordCountNode.textContent = payload.records.length;
    errorsNode.textContent = payload.errors.length
      ? JSON.stringify(payload.errors, null, 2)
      : "无错误";
    statusNode.textContent = `完成：${payload.meta.generated_at}`;
  } catch (err) {
    statusNode.textContent = `失败：${err.message}`;
    errorsNode.textContent = String(err);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", refresh);
