# ModelAtlas: Qwen vs Llama 对比网页

这是一个可本地运行的一键聚合看板：从 **Hugging Face** 和 **ModelScope（魔搭）** 拉取 `Qwen` 与 `Llama` 相关开源模型数据，并生成多维统计表与图表。

## 功能

- 一键拉取两大平台数据（后端接口：`/api/models/refresh`）
- 自动聚合统计：模型数量、总下载、平均下载、总点赞、平均点赞
- Top 模型排行（下载 / 点赞）
- 可视化柱状图对比（平台 × 系列）
- 页面显示抓取错误，便于后续优化 API 兼容

## 本地运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

打开浏览器访问：`http://127.0.0.1:5000`

## 目录结构

```text
.
├── app.py
├── requirements.txt
├── Dockerfile
├── gunicorn.conf.py
├── static/
│   ├── app.js
│   └── style.css
└── templates/
    └── index.html
```

## 云端快速试跑（推荐 Docker，ECS 一条龙）

如果你是“我先在云上跑起来看看效果”，建议优先用 Docker。

### 1) ECS 准备

- 放行安全组端口：`80`（如果你直接映射 5000 也要放行 `5000`）
- 安装 Docker（Ubuntu 示例）

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
```

### 2) 上传代码后在 ECS 运行

```bash
git clone <your-repo-url>
cd ModelAtlas
sudo docker build -t modelatlas:latest .
sudo docker run -d --name modelatlas -p 80:5000 --restart always modelatlas:latest
```

### 3) 浏览器访问

- `http://你的ECS公网IP/`
- 点击页面里的 **一键拉取并分析** 即可看到统计和图表。

## 非 Docker 部署（Gunicorn + Nginx）

### 1) 基础环境

- Ubuntu 22.04 / CentOS 7+
- Python 3.10+
- Nginx

### 2) 生产启动（Gunicorn）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
gunicorn -c gunicorn.conf.py app:app
```

### 3) Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain-or-ip;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4) 开机自启（systemd）

可将 gunicorn 包装为 systemd service（建议在 `/etc/systemd/system/modelatlas.service`），并开启 `restart=always`。

## 后续增强建议

- 加缓存层（Redis）降低 API 压力
- 增加筛选器（许可证、任务类型、时间区间）
- 增加 CSV / Excel 导出
- 增加细粒度模型详情页
