import { Typography } from 'antd';
import { splitCodeFences } from '../../lib/codeFence';
import CodeBlock from './CodeBlock';

interface Props {
  text: string;
  strong?: boolean;
}

/** 富文本渲染：普通段落 + ``` 围栏代码块（Shiki 只读高亮）。 */
export default function RichText({ text, strong }: Props) {
  return (
    <>
      {splitCodeFences(text).map((seg, i) =>
        seg.kind === 'code' ? (
          <div key={i} style={{ margin: '8px 0' }}>
            <CodeBlock code={seg.content} language={seg.language} />
          </div>
        ) : (
          <Typography.Paragraph key={i} strong={strong} style={{ whiteSpace: 'pre-wrap' }}>
            {seg.content}
          </Typography.Paragraph>
        ),
      )}
    </>
  );
}
