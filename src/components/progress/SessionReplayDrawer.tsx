import { Alert, Card, Drawer, Empty, List, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { SessionQuestion } from '../../schemas/session';
import type { SessionRecord } from '../../schemas/learner';
import { categoryLabel } from '../../domain/categories';
import RichText from '../common/RichText';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function letterList(idxs: number[]): string {
  if (!idxs || idxs.length === 0) return '（无）';
  return idxs.map((i) => LETTERS[i] ?? `#${i + 1}`).join('、');
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 历史会话回放：只读渲染当次原题快照（含 AI 变体），不含用户作答（作答未落库）。 */
export default function SessionReplayDrawer({
  record,
  onClose,
}: {
  record: SessionRecord | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  // 本组件常驻挂载（ProgressPage 不卸载它），关闭只把 open 置 false、父级把 record 置 null。
  // 若不同步复位 open，再次点击其它会话行时 record 变了但 open 仍为 false ⇒ 抽屉再也打不开。
  useEffect(() => {
    if (record) setOpen(true);
  }, [record]);
  const close = () => {
    setOpen(false);
    onClose();
  };

  const questions = record?.questions;

  return (
    <Drawer
      title={record ? `会话回放 · ${record.title}` : '会话回放'}
      width={680}
      open={open && !!record}
      onClose={close}
      destroyOnClose
    >
      {record && (
        <>
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color={record.overall >= 80 ? 'success' : record.overall >= 60 ? 'gold' : 'error'}>
              {record.overall} 分
            </Tag>
            <Typography.Text type="secondary">{fmtDate(record.startedAt)}</Typography.Text>
            <Typography.Text type="secondary">共 {questions?.length ?? 0} 题</Typography.Text>
          </Space>

          {!questions || questions.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="该会话记录于旧版本，未保存题目快照，无法原样回放。"
            />
          ) : (
            <List
              dataSource={questions}
              renderItem={(sq: SessionQuestion, i) => {
                const q = sq.question;
                const res = record.questionResults.find((r) => r.questionId === q.id);
                const scoreTag = res ? (
                  <Tag color={res.correct === true ? 'success' : res.correct === false ? 'error' : 'default'}>
                    {res.correct === true ? '正确' : res.correct === false ? '错误' : `${res.score} 分`}
                  </Tag>
                ) : null;
                if (sq.format === 'choice') {
                  const cf = q.formats.choice!;
                  const stem = cf.question ?? q.question;
                  const correctSet = new Set(cf.answer);
                  const sel = (((record.answers?.[q.id] as number[] | undefined) ?? []).slice().sort((a, b) => a - b));
                  return (
                    <List.Item>
                      <Card
                        size="small"
                        style={{ width: '100%' }}
                        title={`第 ${i + 1} 题 · ${categoryLabel(q.category)} · ${cf.type === 'multiple' ? '多选' : '单选'}`}
                        extra={scoreTag}
                      >
                        <RichText text={stem} strong />
                        <Typography.Text type="secondary">你的选择：</Typography.Text>
                        <Typography.Text>{letterList(sel)}</Typography.Text>
                        <List
                          size="small"
                          dataSource={cf.options}
                          renderItem={(opt, oi) => (
                            <List.Item style={{ padding: '2px 0' }}>
                              <Space>
                                <Typography.Text strong={correctSet.has(oi)} style={correctSet.has(oi) ? { color: '#52c41a' } : undefined}>
                                  {LETTERS[oi]}.
                                </Typography.Text>
                                <RichText text={opt} />
                                {correctSet.has(oi) && (
                                  <Tag color="success" style={{ marginInlineStart: 4 }}>
                                    正确答案
                                  </Tag>
                                )}
                              </Space>
                            </List.Item>
                          )}
                        />
                        <Typography.Text type="secondary">正确答案：</Typography.Text>
                        <Typography.Text strong>{letterList([...cf.answer].sort((a, b) => a - b))}</Typography.Text>
                        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                          解析：{q.explanation}
                        </Typography.Paragraph>
                      </Card>
                    </List.Item>
                  );
                }
                const of = q.formats.open!;
                const userAnswer = (record.answers?.[q.id] as string | undefined) ?? '';
                return (
                  <List.Item>
                    <Card
                      size="small"
                      style={{ width: '100%' }}
                      title={`第 ${i + 1} 题 · ${categoryLabel(q.category)}${of.language ? ` · 编程（${of.language}）` : ''}`}
                      extra={scoreTag}
                    >
                      <RichText text={q.question} strong />
                      <Typography.Text type="secondary">你的回答：</Typography.Text>
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                        {userAnswer.trim() ? userAnswer : '（未作答）'}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary">参考答案：</Typography.Text>
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{of.referenceAnswer}</Typography.Paragraph>
                      <Typography.Paragraph type="secondary">解析：{q.explanation}</Typography.Paragraph>
                    </Card>
                  </List.Item>
                );
              }}
            />
          )}
        </>
      )}
      {!record && <Empty description="未选择会话" />}
    </Drawer>
  );
}
