// >v<✅自检-操作历史-撤销栈每一步的那句人话（core/history.js）
// node core/test/history.test.js
import { describeChange } from '../history.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const A = '观测 -> 决策\n  敌方\n决策\n行动';

ok(describeChange(A, A + '\n兜底').desc === '新建 兜底', '新建');
ok(describeChange(A, '观测 -> 决策\n  敌方\n决策').desc === '删除 行动', '删除');
ok(describeChange(A, '观测 -> 判断\n  敌方\n判断\n行动', { moved: ['__synapsis/决策.md → __synapsis/判断.md'] }).desc === '改名 决策 → 判断', '改名（服务端报的搬文件）不算「删 + 建」，连线改指也不重复报');
ok(describeChange(A, A + '\n行动 -> 观测').desc.includes('连线') || describeChange(A, '观测 -> 决策, 行动\n  敌方\n决策\n行动').desc === '连线 观测 → 行动', '连线');
ok(describeChange(A, '观测\n  敌方\n决策\n行动').desc === '删连线 观测 → 决策', '删连线');
ok(describeChange(A, A).desc === '（大纲没变）' && describeChange(A, '决策\n观测 -> 决策\n  敌方\n行动').desc === '排序 / 缩进 / 文本细节', '没变 / 只换了顺序');
// 2026-10-08 文本查找误改的现场：「决策」被换成换行 → 一眼看出来
const B = '场景大局观空间 -> 决策空间, 短期记忆\n决策空间\n短期记忆';
const d = describeChange(B, '场景大局观空间 -> \n空间, 短期记忆\n决策空间\n短期记忆');
ok(d.items.includes('新建 空间, 短期记忆') && d.items.includes('删连线 场景大局观空间 → 决策空间') && d.items.includes('删连线 场景大局观空间 → 短期记忆'), '误改现场写得清楚 ' + d.desc);
const many = describeChange('a', 'a\nb\nc\nd\ne');
ok(/等 4 处$/.test(many.desc) && many.items.length === 4, '多于 3 条 → 「等 N 处」 ' + many.desc);

console.log(`history: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0;
