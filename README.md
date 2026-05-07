# 开源模型影响力仪表盘

一个无依赖的静态网站，用 Hugging Face Hub API 实时获取 Qwen、DeepSeek、OpenAI、Llama / Meta、GLM / Zhipu、MiniMax 官方生成式大语言模型和多模态模型的下载数据。

## 使用

本地服务器已经可以用下面的命令启动：

```bash
python3 -m http.server 5173
```

浏览器打开：

```text
http://localhost:5173/
```

点击页面右上角的“数据更新”，会重新请求 Hugging Face 并刷新所有图表。最近一次成功结果会缓存在浏览器 `localStorage` 中，页面重新打开时会先展示缓存，再尝试刷新。

## 数据口径

- `downloadsAllTime`：模型自创建以来的累计下载量。
- `downloads`：Hugging Face 当前返回的近 30 天下载量。
- 模型范围：默认只统计各公司官方 Hugging Face 组织下的公开模型。
- 类型范围：保留生成式大语言模型与生成式多模态模型；过滤 CLIP、SigLIP、ViT、embedding、reranker、encoder-only、分类/检测/分割等组件型模型。
- GLM 范围：从 `THUDM`、`zai-org` 中筛选名称或标签包含 `glm/chatglm` 的模型，避免混入同组织下其它系列。
- 参考：[Hugging Face `ModelInfo`](https://huggingface.co/docs/huggingface_hub/package_reference/hf_api#huggingface_hub.hf_api.ModelInfo) 文档说明了 `downloads` 和 `downloads_all_time` 字段；下载计数规则见 [Models Download Stats](https://huggingface.co/docs/hub/models-download-stats)。

## 影响力指标

- 累计下载量：长期采用规模。
- 近 30 天下载量：近期热度和动量。
- 综合影响力指数：累计下载、近期下载、模型数量、点赞数的加权评分。
- 头部集中度：Top 5 模型下载量占比，用来判断影响力是否集中在少数爆款。
- 年度发布节奏：按模型创建年份观察各家的开源节奏。

## 调整公司或账号

修改 [app.js](./app.js) 顶部的 `COMPANIES` 配置即可添加或调整 Hugging Face 组织账号。
