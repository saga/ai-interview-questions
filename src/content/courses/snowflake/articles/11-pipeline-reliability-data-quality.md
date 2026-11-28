# 增量管道可靠性：幂等、迟到数据与质量门禁

## 把“任务成功”与“数据正确”分开

管道状态显示 SUCCESS，只能说明编排层认为本次执行成功，不能证明源记录完整、目标没有重复、业务金额一致或数据已达到新鲜度目标。生产管道至少要维护四类证据：执行状态、数据质量、源目标对账和下游新鲜度。

## 幂等不是简单去重

增量任务经常因为网络中断、超时、调度重试或人工重跑再次执行。幂等设计要求同一批输入重复执行不会造成重复业务结果。常用做法是稳定业务键、批次标识、明确的变更顺序和可重放窗口。

~~~sql
MERGE INTO CURATED_ORDERS AS target
USING STAGED_ORDERS AS source
ON target.ORDER_ID = source.ORDER_ID
WHEN MATCHED AND source.SOURCE_UPDATED_AT >= target.SOURCE_UPDATED_AT THEN
  UPDATE SET
    AMOUNT = source.AMOUNT,
    STATUS = source.STATUS,
    SOURCE_UPDATED_AT = source.SOURCE_UPDATED_AT
WHEN NOT MATCHED THEN
  INSERT (ORDER_ID, AMOUNT, STATUS, SOURCE_UPDATED_AT)
  VALUES (source.ORDER_ID, source.AMOUNT, source.STATUS, source.SOURCE_UPDATED_AT);
~~~

MERGE 只有在匹配键、来源去重和更新优先级正确时才可能达到预期。若一个目标键在 source 中出现多行，必须先确定冲突策略，而不是依赖 SQL 执行顺序。

## 迟到、重复与修正数据

事件时间、到达时间和处理时间是不同时间概念。数据可能迟到，源系统也可能更正历史记录。管道需要定义允许迟到窗口、历史回补范围、重复事件规则和删除语义。对财务、库存和订单系统，业务日期和源系统更新时间通常都要保留。

## 质量门禁

- 完整性：批次记录数、关键字段空值、主键缺失。
- 唯一性：业务键重复、重复文件和重复事件。
- 合法性：金额范围、状态枚举、时间顺序和引用完整性。
- 一致性：来源与目标的数量、金额、汇总和关键维度对账。
- 新鲜度：从源产生到消费可见的端到端延迟。

异常数据应进入隔离表，记录规则 ID、失败字段、来源和批次。人工修正后要能按原批次重放。

## Schema 漂移

上游增加字段通常比删除或改变字段类型风险小，但仍可能破坏下游 SELECT *、强制转换和语义契约。关键表应采用显式列清单、兼容性检查、变更通知和部署门禁。

## 事故处理

恢复时不要只重跑失败任务。先确定上游是否已补齐、目标是否已部分写入、Stream offset 是否推进、下游是否消费，然后选择重放、补偿或全量重建。恢复后重新做源目标对账。

## 检查题

1. MERGE 为什么不能自动保证幂等？
2. 数据质量检查应在哪些层次执行？
3. 上游 Schema 变化后，为什么 SELECT * 会增加生产风险？
