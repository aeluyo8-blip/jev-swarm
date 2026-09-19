**Jev Swarm**

**10-Snake Arena**

Real-time Parallel Decision Making with a System-One Model

  -----------------------------------------------------------------------
  **给编程 Agent 的一句话任务\**
  实现一个浏览器中的多主体贪吃蛇实验：同一共享世界中运行 10
  条合作蛇；每个逻辑 tick 只向 Jev 发起一次请求，在同一 state 上并行获得
  10 条蛇的动作概率分布；再由确定性的 Joint Action Resolver
  解决多蛇之间的硬冲突并执行联合动作。项目重点是测试 Jev
  的并行决策、低延迟、概率输出和软件组合能力，而不是单纯做一个小游戏。
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

**10 agents · 10 judgments · 1 model call · every tick**

# 1. 项目目标与边界

  -----------------------------------------------------------------------
  **核心研究问题\**
  一个 System-One 模型能否在一个实时共享世界中，用一次 API
  调用同时给多个相互影响的 Agent
  产生有用的局部决策，并由传统代码组合成可靠的联合行为？
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 1.1 必须验证的四件事

- 并行性：1 / 2 / 5 / 10 / 20
  条蛇时，单次请求延迟是否随着问题数增加而缓慢增长，而不是近似线性增长。

- 决策质量：Jev Raw 是否明显优于 Random，并至少能达到简单 Rule/Greedy
  Agent 的可比水平。

- 概率价值：完整 Choice 概率分布是否能在冲突发生时提供有效的 next-best
  fallback，而不是每次都重新请求模型。

- 组合价值：Jev + deterministic Joint Resolver 是否能比 Jev Raw
  显著降低碰撞，同时又不是由 Resolver 完全替模型"玩游戏"。

## 1.2 明确不做

- 不做视觉识别、不接真实游戏、不训练 RL、不训练自定义模型。

- 不做复杂物理引擎、不做地图编辑器、不做联网多人模式。

- 不让 Jev 计算距离、Flood Fill、碰撞、合法动作、精确坐标或路径规划。

- 不为每条蛇单独调用一次 API；每个 tick 必须是一次请求包含全部蛇的问题。

- 不把 Safety/Resolver
  写成一个聪明到足以单独玩好游戏的算法，否则无法判断 Jev
  是否真的贡献了智能。

## 1.3 对外定位

**项目名：**Jev Swarm\
**Showcase：**10-Snake Arena\
**Headline：One world. Ten agents. Ten judgments. One Jev call.**

# 2. 游戏规则（MVP）

  ------------------------------------------------------------------------------
  **参数**                            **默认值 / 规则**
  ----------------------------------- ------------------------------------------
  地图                                30 × 30 网格

  蛇数量                              默认 10；可切换 1 / 2 / 5 / 10 / 20

  初始长度                            3

  食物                                同时存在 5\~10 个；被吃后立即补充

  目标                                全体尽可能长时间存活，同时最大化总食物数

  逻辑 Tick                           默认 250 ms（4 Hz），可配置

  渲染                                requestAnimationFrame / 60
                                      FPS，仅做插值显示

  蛇动作                              LEFT / STRAIGHT / RIGHT（相对当前朝向）
  ------------------------------------------------------------------------------

## 2.1 硬碰撞规则

- 撞墙死亡。

- 蛇头进入任意蛇身体占用格死亡。

- 两条或多条蛇头在同一 tick 进入同一目标格，视为 head conflict。

- 两条蛇交换彼此蛇头位置，视为 head-swap conflict。

- 第一版将所有蛇视为合作主体，不允许"吃掉对方"作为奖励机制。

# 3. 总体架构

┌─────────────────────────────┐\
│ Snake World │\
│ deterministic game engine │\
└──────────────┬──────────────┘\
│ snapshot\
▼\
┌─────────────────────────────┐\
│ State Analyzer │\
│ legal / distance / flood │\
│ space / risk / conflicts │\
└──────────────┬──────────────┘\
│ shared state + N questions\
▼\
┌─────────────────────────────┐\
│ Jev │\
│ ONE request / tick │\
│ N parallel Choice outputs │\
└──────────────┬──────────────┘\
│ probability matrix\
▼\
┌─────────────────────────────┐\
│ Joint Action Resolver │\
│ maximize model preference │\
│ subject to hard constraints │\
└──────────────┬──────────────┘\
│ joint action\
▼\
┌─────────────────────────────┐\
│ Execute │\
└─────────────────────────────┘

## 3.1 通用化要求

Snake 只是第一种
World。核心层必须保持通用，未来可替换为多车、仓储机器人、无人机或 NPC。

interface MultiAgentWorld {\
getSharedState(): WorldState\
getAgents(): Agent\[\]\
getCandidates(agent: Agent): CandidateAction\[\]\
analyzeCandidate(agent: Agent, action: CandidateAction): ActionFeatures\
validateJointActions(actions: JointAction): ValidationResult\
step(actions: JointAction): void\
}

# 4. State Analyzer：代码负责"事实"，Jev 负责"判断"

  -------------------------------------------------------------------------------
  **设计原则\**
  不要把原始网格丢给
  Jev，让它自己算距离、计数或可达区域。先由代码计算确定性事实，再把这些事实交给
  Jev 做快速 contextual judgment。
  -------------------------------------------------------------------------------

  -------------------------------------------------------------------------------

## 4.1 每条蛇至少计算的 Action Features

- legal：该动作是否违反立即的静态规则。

- food_distance_after_move：执行后到最近食物的 Manhattan/BFS 距离。

- reachable_free_cells：执行后从蛇头可达的空闲格数量（Flood Fill）。

- nearest_other_head：执行后距其他蛇头的最小距离。

- dead_end_risk：基于可达空间、蛇长和出口数量生成 low / medium / high。

- head_conflict_candidates：该目标格是否可能被其他蛇在下一 tick 选择。

- wall_distance / body_distance：可选，只做辅助特征。

## 4.2 推荐 State Schema

{\
\"world\": {\
\"board\": {\"width\": 30, \"height\": 30},\
\"food\": \[\[4, 7\], \[12, 18\], \[22, 3\]\],\
\"team_goal\": \"Keep all snakes alive while collecting as much food as
possible.\",\
\"tick\": 1842\
},\
\
\"agents\": {\
\"snake_01\": {\
\"length\": 7,\
\"current_direction\": \"east\",\
\"left\": {\
\"legal\": true,\
\"food_distance_after_move\": 9,\
\"reachable_free_cells\": 151,\
\"nearest_other_head\": 5,\
\"dead_end_risk\": \"low\"\
},\
\"straight\": {\
\"legal\": true,\
\"food_distance_after_move\": 4,\
\"reachable_free_cells\": 88,\
\"nearest_other_head\": 2,\
\"dead_end_risk\": \"medium\"\
},\
\"right\": {\
\"legal\": true,\
\"food_distance_after_move\": 3,\
\"reachable_free_cells\": 31,\
\"nearest_other_head\": 1,\
\"dead_end_risk\": \"high\"\
}\
}\
}\
}

## 4.3 State 大小原则

- 不传整个历史；每个 tick 只传当前决策所需状态。

- 不传像素、不传冗余路径、不传每个空格的全量描述。

- 对 20 条蛇扩展时，优先压缩为 action features，而不是把 board 数据重复
  20 次。

- 共享信息放在 shared state；每条蛇只保留局部 features。

# 5. Jev 调用设计

## 5.1 每个 Tick 只调用一次

request = {\
state: shared_world_state,\
questions: \[\
{ id: \"snake_01_move\", type: \"Choice\", options: \[\"LEFT\",
\"STRAIGHT\", \"RIGHT\"\] },\
{ id: \"snake_02_move\", type: \"Choice\", options: \[\"LEFT\",
\"STRAIGHT\", \"RIGHT\"\] },\
\...\
{ id: \"snake_10_move\", type: \"Choice\", options: \[\"LEFT\",
\"STRAIGHT\", \"RIGHT\"\] }\
\]\
}

## 5.2 问题语义

Given the current shared world state and the team\'s goal of keeping
every snake alive\
while collecting food, choose the best immediate move for snake_01.\
\
Prefer survival over short-term food gain.\
Use only the provided action features.\
Return a Choice over LEFT / STRAIGHT / RIGHT.

**要求：**所有蛇的问题使用一致模板，只替换 agent
id。不要让某个问题引用另一个问题的"答案"，因为同一请求中的问题应视为独立判断。

## 5.3 需要记录的原始输出

- 每条蛇对 LEFT / STRAIGHT / RIGHT 的完整概率分布。

- top-1 action。

- confidence（若 SDK 提供）。

- 整个请求 latency、token usage、错误码。

- request state revision / tick id，用于 stale response 检查。

# 6. Joint Action Resolver（项目核心）

  -----------------------------------------------------------------------
  **为什么需要它\**
  Jev 的多个问题共享同一
  state，但并不会在响应生成过程中互相协商。因此两个 top-1
  动作可能同时指向同一格。Resolver 的职责只是满足硬约束并尽量尊重 Jev
  的概率偏好。
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 6.1 优化目标

在所有联合动作 A 中，选择：

A\* = argmax_A Σ_i log P_i(a_i)\
\
subject to:\
- no wall collision\
- no body collision\
- no shared target cell\
- no head-swap collision

## 6.2 10 条蛇第一版实现

每条蛇只有 3 个相对动作，10 条蛇总联合动作数为 3\^10 =
59,049。第一版直接枚举所有组合并剪枝即可，简单、透明、易验证。

best_score = -inf\
best_joint_action = None\
\
for combination in product(\[\"LEFT\", \"STRAIGHT\", \"RIGHT\"\],
repeat=N):\
if not passes_hard_constraints(combination):\
continue\
\
score = 0\
for i, action in enumerate(combination):\
p = max(probabilities\[i\]\[action\], 1e-8)\
score += log(p)\
\
if score \> best_score:\
best_score = score\
best_joint_action = combination\
\
return best_joint_action

## 6.3 扩展到 20+ Agent

- 不要继续暴力枚举 3\^20。

- 可改为 beam search / branch-and-bound / ILP / min-conflict heuristic。

- MVP 只需要 10 条蛇可靠运行；20 条主要用于 scaling
  benchmark，可适当降低 Joint Resolver 复杂度。

## 6.4 必须区分三个动作

  -----------------------------------------------------------------------
  字段                    含义                    UI 展示
  ----------------------- ----------------------- -----------------------
  proposed_action         Jev top-1               Jev 最想走的方向

  executed_action         Resolver 最终选择       真正执行的方向

  override_reason         若不同，说明原因        conflict with S7 / wall
                                                  / body
  -----------------------------------------------------------------------

# 7. 运行模式与公平 Benchmark

  ----------------------------------------------------------------------------
  模式                                目的
  ----------------------------------- ----------------------------------------
  Random                              最低基线；从合法动作随机选择。

  Rule / Greedy                       非 AI
                                      基线；偏向最近食物，同时避免明显死路。

  Jev Raw                             直接执行每条蛇的 Jev
                                      top-1；不做多蛇联合冲突修正。

  Jev Joint                           Jev 概率矩阵 + Joint Action
                                      Resolver。核心模式。
  ----------------------------------------------------------------------------

## 7.1 Scaling Benchmark

分别运行 1 / 2 / 5 / 10 / 20 条蛇。每档至少跑固定数量 tick，并记录：

- Jev p50 / p95 latency。

- questions per call。

- tokens / request、estimated cost / minute。

- deadline miss rate。

- 平均存活时间 / 全员存活率。

- food per minute。

- raw head conflicts / actual collisions。

- resolver override rate。

## 7.2 关键诊断指标

  -----------------------------------------------------------------------
  **非常重要\**
  如果 Jev Joint 表现很好，但 Resolver override rate 极高（例如长期
  \>50%），说明真正"玩游戏"的可能是 Resolver 而不是
  Jev。必须把该指标放在首页。
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 8. 实时循环、超时与 Stale Response

Tick N:\
1. snapshot world, revision = R\
2. compute deterministic features\
3. send ONE Jev request asynchronously\
4. wait until decision deadline\
5. if response arrives and revision is still usable:\
run Joint Resolver\
execute\
else:\
deterministic fallback\
6. advance world

## 8.1 建议时序

- 渲染 60 FPS；游戏逻辑默认 4 Hz。

- Jev 请求异步，不阻塞 UI。

- 设置明确 decision deadline，例如 220\~250 ms；超时使用 fallback。

- 响应必须带 tick/revision；如果返回时局面已经不可用，则丢弃并计入
  stale_response。

## 8.2 Fallback 原则

Fallback 必须"够安全但不够聪明"：

- 优先维持 STRAIGHT，若立即非法再选安全空间最大的动作。

- 不主动追食物，不做复杂全局协调。

- 这样可以确保 API 超时时游戏不会直接崩溃，但也不会掩盖 Jev 的贡献。

# 9. UI / Demo 设计

## 9.1 主界面

┌────────────────────────────────────┬──────────────────┐\
│ │ JEV SWARM │\
│ Snake Board │ │\
│ │ Agents 10 │\
│ 10 colored snakes + food │ One call/tick │\
│ │ Latency 184 ms │\
│ │ Alive 10/10 │\
│ │ Food 37 │\
│ │ Conflicts 3 │\
│ │ Overrides 2 │\
│ │ │\
│ │ S3 → RIGHT 82% │\
│ │ ↳ STRAIGHT │\
│ │ conflict S7│\
└────────────────────────────────────┴──────────────────┘

## 9.2 必须有的控件

- Mode：Random / Rule / Jev Raw / Jev Joint。

- Agents：1 / 2 / 5 / 10 / 20。

- Safety：ON / OFF（本质切换是否启用 Joint Resolver）。

- Chaos：一次性改变食物位置、加入静态障碍或缩小可用区域，制造突发局面。

- Pause / Reset。

## 9.3 Decision Lens

点击任意蛇，展开最近一次：

- LEFT / STRAIGHT / RIGHT 概率条。

- proposed_action vs executed_action。

- override_reason。

- 局部 action features。

- 本 tick latency / confidence。

# 10. 推荐技术栈与目录

## 10.1 技术栈

- Frontend：Vite + React + TypeScript。

- Rendering：Canvas 2D（不要上 Three.js）。

- State：普通 TypeScript store 即可；如需状态库优先 Zustand。

- Backend：Node/TypeScript 小型 API proxy，仅用于隐藏 TYPESAFE_API_KEY
  与调用 Jev。

- Benchmark：同仓库保存 CSV/JSONL，前端提供简单曲线。

## 10.2 文件结构

src/\
game/\
engine.ts\
snake.ts\
collision.ts\
features.ts\
\
jev/\
state.ts\
questions.ts\
client.ts\
types.ts\
\
swarm/\
resolver.ts\
fallback.ts\
\
benchmark/\
metrics.ts\
runner.ts\
export.ts\
\
ui/\
Board.tsx\
ControlPanel.tsx\
DecisionLens.tsx\
MetricsPanel.tsx\
\
server/\
api.ts\
\
tests/\
collision.test.ts\
resolver.test.ts\
feature.test.ts

# 11. 分阶段开发计划

## Phase 0 --- 骨架

- 初始化 Vite + React + TypeScript。

- 实现 1 条蛇、食物、碰撞、Reset、固定 tick。

- 实现 Canvas UI 和右侧基础指标面板。

## Phase 1 --- 多蛇 deterministic world

- 扩展到 10 条蛇。

- 实现跨蛇 body collision、head conflict、head-swap。

- 实现 Random 和 Rule baseline。

- 为每条蛇生成 LEFT / STRAIGHT / RIGHT action features。

## Phase 2 --- Jev integration

- 接入官方 Jev SDK/API。

- 一个 request 内批量放入 N 个 Choice question。

- 保存完整概率分布与 latency/token metrics。

- 实现 deadline、错误、fallback、stale response。

## Phase 3 --- Joint Resolver

- 实现 3\^N 枚举 + hard-constraint 剪枝（N=10）。

- 目标函数使用 sum(log(probability))。

- 记录 proposed/executed/override_reason。

- 补充 resolver 单元测试。

## Phase 4 --- Benchmark & demo

- 实现 1/2/5/10/20 agent scaling runner。

- 实现 Jev Raw / Jev Joint / Rule / Random 对照。

- 实现 Chaos、Safety Toggle、Decision Lens。

- 导出 CSV/JSONL 和 benchmark summary。

# 12. 验收标准（Definition of Done）

- □ 默认 10 条蛇能在同一浏览器画布中同时运行。

- □ Jev 模式下每个逻辑 tick 只有一次 Jev 请求，并包含全部 agent 的问题。

- □ 前端能看到每条蛇完整 Choice 概率，而不只是 top-1。

- □ Jev Raw 与 Jev Joint 可一键切换。

- □ Joint Resolver 能处理 shared-target 与 head-swap 冲突，并显示
  override 原因。

- □ API 超时不会卡住渲染；存在 deterministic fallback。

- □ 所有响应使用 tick/revision 检查，过期响应不执行。

- □ 提供 1/2/5/10/20 agents 的 latency benchmark。

- □ 提供 Random / Rule / Jev Raw / Jev Joint 四种模式的存活与吞食统计。

- □ 首页显示 resolver override rate，避免掩盖模型真实贡献。

# 13. Go / No-Go 判定

  -------------------------------------------------------------------------------------------
  问题                    Go                       No-Go
  ----------------------- ------------------------ ------------------------------------------
  并行扩展                10-question request      问题数增长导致近似线性延迟，失去并行优势
                          仍保持明显低延迟         

  智能贡献                Jev Raw 明显优于         Jev Raw 长期接近随机
                          Random，接近或超过简单   
                          Rule                     

  概率价值                Resolver 可利用          概率分布无区分度，fallback 基本随机
                          next-best                
                          概率显著减少冲突         

  组合价值                Jev Joint                大部分动作长期被 Resolver 改写
                          稳定提升，override rate  
                          合理                     
  -------------------------------------------------------------------------------------------

  -------------------------------------------------------------------------------------------------------------
  **停止条件\**
  如果"Jev Raw 没有明显 intelligence advantage"或者"Jev Joint 的好表现主要由 Resolver
  高比例覆盖产生"，不要继续扩展视觉、真实游戏或复杂多智能体场景。这个项目首先是模型测试，不是为了做大而做大。
  -------------------------------------------------------------------------------------------------------------

  -------------------------------------------------------------------------------------------------------------

# 14. 给编程 Agent 的执行约束

- 优先完成可运行的闭环，不先做美术优化。

- 任何新增算法都要问：它是否会掩盖 Jev 的贡献？如果会，保持最简单。

- 所有关键随机过程支持固定 seed，保证 benchmark 可复现。

- 核心模块必须有单元测试，尤其是 collision、head-swap、resolver。

- 每个 benchmark 保存配置：agent count、tick rate、mode、seed、API/model
  version、时间戳。

- 不要把 API key 放到前端 bundle。

- 实现时保持 MultiAgentWorld / Resolver / ModelClient 解耦，避免项目被
  Snake 绑定死。

## 14.1 Agent 开工顺序

1.  先实现 deterministic SnakeWorld + 10 snakes + Random/Rule，确保无
    Jev 也能稳定跑。

2.  实现 feature extractor，并通过 debug overlay 验证每个 action feature
    正确。

3.  接入 Jev，一次请求批量 N 个 Choice；先从 2 条蛇调通，再扩到 10。

4.  实现 Jev Raw，记录真实碰撞与延迟。

5.  实现 Joint Resolver 与 override telemetry。

6.  最后才加 Benchmark UI、Chaos 和视觉打磨。

# 15. 参考资料

• [[TypeSafe AI
Documentation]{.underline}](https://docs.typesafe.ai/introduction)

• [[TypeSafe AI --- Choice
Primitive]{.underline}](https://docs.typesafe.ai/primitives/choice)

• [[TypeSafe AI --- Jev Model
Jaggedness]{.underline}](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

• [[Existing Jev Snake
experiment]{.underline}](https://github.com/sorrycc/typesafe-snake)

• [[Jev Browser
experiment]{.underline}](https://github.com/jkudish/jev-browser)

• [[HEIST//ONE]{.underline}](https://github.com/AbdelStark/heist-one)

  -----------------------------------------------------------------------
  **最终交付目标\**
  交付一个可在本地运行的 Jev Swarm Web Demo + Benchmark：默认 10
  条蛇、一次 Jev call/tick、完整概率可视化、Jev Raw/Jev Joint 对照、Joint
  Resolver、超时 fallback、1/2/5/10/20 scaling
  benchmark，以及可导出的实验结果。
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
