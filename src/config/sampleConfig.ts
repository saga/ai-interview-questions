import sampleConfig from './sample-config.json';
import type { AIConfig } from '../schemas/ai-config';

/**
 * 干净、可被应用代码直接引用的配置样例。
 * 与 docs/config.example.json 的区别：这里严格契合 AIConfig schema（无 $comment / $字段说明 等元字段），
 * 且 chrome / local 启用、其余引擎 disabled —— 可作为“加载示例”预设直接注入设置页编辑器。
 */
export const SAMPLE_CONFIG: AIConfig = sampleConfig as AIConfig;
