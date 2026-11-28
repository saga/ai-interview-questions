# Apache Iceberg 写入并发、提交冲突与重试

## 两个任务都写完文件，为什么只有一个提交成功

订单流持续追加数据，批处理任务同时执行 MERGE 和小文件合并。两个作业都读取同一个 Iceberg Snapshot，也都生成了新的 Parquet 文件。作业结束时，一个提交成功，另一个报 CommitFailedException 或 ValidationException。

这不表示数据文件损坏。Iceberg 用不可变文件和快照元数据描述表状态。写入任务先基于读取到的快照准备新元数据，再通过 Catalog 支持的原子操作更新当前元数据引用。提交时才发现并发变化，这就是乐观并发控制。

## 元数据提交冲突和数据验证冲突不同

假设 Writer A 和 B 都基于 Snapshot 100 开始。A 先提交 Snapshot 101。B 随后更新当前元数据引用时，发现表已前进。若 B 的操作前提仍然成立，Writer 可以基于新快照重建提交；若 B 依赖的文件已被其他任务删除或替换，就不能安全重放。

Append 通常只增加新文件，冲突后较容易在新快照上重新提交。Compaction 则把旧文件替换为新文件：如果被替换的源文件已不再属于当前快照，原替换清单就失效。UPDATE、DELETE 和 MERGE 还要判断并发新增或修改是否改变了谓词结果。

因此要区分 Catalog Commit Conflict 与数据验证冲突。前者可能只是元数据版本先被别人更新；后者意味着原操作的业务前提可能已失效。捕获所有异常后重复执行同一段写入，不是通用恢复策略。

## 重试前必须重新验证原操作的前提

Iceberg 的提交由假设和动作组成。发生冲突后，写入引擎会检查当前表状态是否仍满足这些假设。以 Compaction 为例，只有表中仍包含被压缩的源文件，才可以安全地移除它们并添加合并后的文件。

不同引擎对自动重试的实现、配置和默认预算并不完全一致。Spark、Flink、Trino、PyIceberg 或其他客户端是否自动刷新元数据、重新应用操作，应按实际版本和 Catalog 验证。不能看到某个 Iceberg 配置项，就假定所有 SQL Engine 都会使用它。

## UPDATE、DELETE 和 MERGE 的隔离级别影响结果

Iceberg 的 Serializable 与 Snapshot 隔离级别改变了并发数据验证范围。Serializable 更严格：如果并发写入新增了同样满足 DELETE/UPDATE 谓词的数据，当前操作可能失败并要求重算。Snapshot 主要关注本次操作直接改写的文件，可能允许并发追加的记录留给下一轮处理。

这不是单纯的性能开关。若 DELETE 必须删除提交时刻所有符合条件的记录，Snapshot 可能不满足业务语义；若任务是按业务键幂等 upsert，Snapshot 有时可以减少与并发追加的不必要冲突。需要先明确并发新增行是否必须包含在本次操作内，再选择隔离级别。

Spark MERGE INTO 还有一个独立约束：同一个目标行不能被多个源记录同时更新。源批次应先按业务键去重或明确冲突规则，否则没有并发 Writer 也可能发生歧义。

## 应用级重试需要幂等和状态确认

发生 ValidationException 时，应用通常要重新读取当前 Snapshot 和源数据，再根据最新状态重新计算受影响的范围。对提交响应超时，先确认 Catalog 是否已经接受提交；服务端可能已提交，但客户端没有收到响应。未确认状态就盲目 Append，可能造成重复数据。

每个批次都应有稳定的 batch_id 或 event_id，记录输入版本、目标 Snapshot、写入模式和最终提交 Snapshot。重试应限制次数和总耗时，并使用指数退避与随机抖动，防止多个失败 Writer 同时再次竞争。幂等键还要结合源端版本或事件顺序，避免较旧事件覆盖新状态。

## 验证并发恢复不能只测正常路径

在测试环境让两个 Writer 基于同一 Snapshot 分别执行 Append、MERGE 和 Rewrite。记录哪些冲突能被库自动重试，哪些会触发验证异常；再模拟“服务端提交成功但客户端响应丢失”，确认恢复逻辑不会重复写入。

检查 Snapshot 历史、文件清单、行数和业务聚合。表仍可读取只是最低标准；没有重复事件、丢失更新或覆盖新数据，才说明恢复策略符合业务要求。

## 容易混淆的提交边界

- 原子提交不等于上游消息到目标表的端到端 exactly-once。
- Append 的可重试性不能推广到 MERGE、DELETE 和 Compaction。
- ValidationException 需要重新验证操作前提，不能只重复旧计划。
- Commit 响应丢失不等于提交失败，重试前应检查 Snapshot 状态。
- Snapshot 与 Serializable 的区别是数据正确性语义，不只是速度开关。
- 增加重试次数不能解决持续的数据范围冲突。

## 自测

1. 两个 Writer 基于同一 Snapshot 追加不同文件，后提交的一方为什么通常可以重新尝试？
2. Compaction 准备替换的源文件已被另一个 Writer 删除，为什么不能照原计划重试？
3. 提交响应超时但 Snapshot 可能已更新，如何避免重复 Append？
4. MERGE 源数据同一业务键出现两行，为什么会导致目标行更新存在歧义？
5. 哪些业务更需要 Serializable？哪些幂等 upsert 可以评估 Snapshot？

## 参考资料

- [Apache Iceberg reliability and concurrent writes](https://iceberg.apache.org/docs/latest/reliability/)
- [Apache Iceberg table specification](https://iceberg.apache.org/spec/)
- [Apache Iceberg Spark writes and MERGE INTO](https://iceberg.apache.org/docs/latest/spark-writes/)
- [Apache Iceberg Spark configuration](https://iceberg.apache.org/docs/latest/spark-configuration/)
- [AWS guidance for handling Iceberg write concurrency](https://docs.aws.amazon.com/prescriptive-guidance/latest/apache-iceberg-on-aws/handling-write-concurrency.html)
