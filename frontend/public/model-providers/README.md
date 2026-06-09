# Model provider logos

Place vendor logo files here. The model selector loads them automatically based on the model's **modelGroup** field (or **provider** as fallback).

## Naming convention

Filename = slug of the group name, with optional alias mapping in code.

Examples:

| modelGroup (in model settings) | Logo file         | Aliases                   |
| ------------------------------ | ----------------- | ------------------------- |
| Anthropic / Claude             | `anthropic.svg`   | Claude                    |
| OpenAI / GPT                   | `openai.svg`      | GPT                       |
| Google / Gemini                | `google.svg`      | Gemini, VertexAI          |
| DeepSeek                       | `deepseek.svg`    |                           |
| Qwen / 通义                    | `qwen.svg`        | Alibaba, AliCloud, Tongyi |
| Kimi / Moonshot                | `kimi.svg`        | Moonshot                  |
| GLM / ChatGLM / 智谱           | `glm.svg`         | ChatGLM, ZhiPu            |
| MiniMax                        | `minimax.svg`     |                           |
| Meta / Llama                   | `meta.svg`        | Llama                     |
| Mistral                        | `mistral.svg`     | MistralAI                 |
| Grok / xAI                     | `xai.svg`         | Grok                      |
| 豆包 / Doubao                  | `doubao.svg`      | ByteDance                 |
| 文心 / Ernie                   | `ernie.svg`       | Baidu, Wenxin             |
| 混元 / Hunyuan                 | `hunyuan.svg`     | Tencent                   |
| 讯飞 / SparkDesk               | `sparkdesk.svg`   | iFlytek                   |
| Yi                             | `yi.svg`          |                           |
| 百川 / Baichuan                | `baichuan.svg`    |                           |
| 阶跃 / StepFun                 | `stepfun.svg`     |                           |
| InternLM                       | `internlm.svg`    |                           |
| SiliconFlow                    | `siliconflow.svg` |                           |
| Ollama                         | `ollama.svg`      |                           |
| OpenRouter                     | `openrouter.svg`  |                           |
| Groq                           | `groq.svg`        |                           |

Supported extensions (tried in order): `.svg`, `.png`, `.webp`

## Tips

- Prefer SVG for crisp display at any size.
- Group name is slugified: `"ZhiPu AI"` → `zhi-pu-ai.svg`
- Common aliases are mapped in `src/components/model-select/model-provider-icon.tsx` (e.g. `Claude` → `anthropic`, `GPT` → `openai`).
- If no matching file is found, the default diamond model icon is shown.

## Setup steps

1. Download vendor logos (square, transparent background recommended).
2. Save to this folder using the slug name above.
3. Set **modelGroup** on each Model CRD to match (e.g. `Anthropic`, `OpenAI`).
4. Restart is not required — logos are static assets served from `/model-providers/`.
