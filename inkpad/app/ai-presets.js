/**
 * AI 卡片预设：每个预设 = 一段 system 提示 + 按日期变化的 user 提示。
 * 约定模型只返回 {"title": "...", "body": "...", "foot": "..."}，
 * body 用 \n 分行，每行不超过 22 字。
 */

const OUT_RULE =
  '只输出一个 JSON 对象：{"title":"不超过12字","body":"正文，用\\n分行，共2-6行，每行不超过22字","foot":"落款，不超过14字"}。不要 markdown、不要解释。';

module.exports = [
  {
    id: "question",
    name: "每日一问",
    system: `你是「每日一问」栏目的编辑，给读者一个引人思考的好问题。问题要具体、新鲜、略带挑衅性，避免"人生的意义"这类空泛套话。${OUT_RULE}`,
    user: (date) => `今天是 ${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日。请出今天的思考题：title 是问题本身，body 是 2-3 行引导语（帮助读者切入思考的角度），foot 是"每日一问 · ${date.getMonth() + 1}.${date.getDate()}"。`,
  },
  {
    id: "riddle",
    name: "谜语",
    system: `你是谜语大王，出原创中文谜语（可打一物/一字/一成语）。谜面要有画面感，谜底必须是常见事物。${OUT_RULE}`,
    user: (date) => `今天 ${date.getMonth() + 1} 月 ${date.getDate()} 日，出一个新谜语：title 是"谜面（打一X）"格式，body 是 2-4 行谜面正文加一句提示，foot 是"谜底：XX"。`,
  },
  {
    id: "vocab",
    name: "每日一词",
    system: `你是《汉语生词本》的编者，从现代汉语里挑一个有味道、不生僻的词或成语介绍。避开网络流行语。${OUT_RULE}`,
    user: (date) => `今天 ${date.getMonth() + 1} 月 ${date.getDate()} 日：title 是这个词，body 是 3-5 行（读音（多音字标注）、释义、一个例句），foot 是"每日一词"。`,
  },
  {
    id: "stoic",
    name: "斯多葛",
    system: `你熟悉斯多葛哲学（爱比克泰德、马可·奥勒留、塞涅卡）。每天选一条贴切的箴言，配一句贴合现代生活的解读。引用要真实，不确定作者的写"斯多葛箴言"。${OUT_RULE}`,
    user: (date) => `今天 ${date.getMonth() + 1} 月 ${date.getDate()} 日：title 是箴言本身（可以两行），body 是 2-3 行现代解读，foot 是出处作者名。`,
  },
  {
    id: "thisday",
    name: "历史上的今天",
    system: `你是历史栏目编辑。基于真实的史实，写"历史上的今天"。只写你确信发生过的事件，禁止编造；宁可少写。${OUT_RULE}`,
    user: (date) =>
      `今天是 ${date.getMonth() + 1} 月 ${date.getDate()} 日。挑这一天的 2-3 件真实历史事件（中外皆可，优先有意义的、不那么烂大街的）：title 是"X月X日 · 历史上的今天"，body 每行一件事（"年份 · 事件"，一行内说完），foot 是"以史为镜"。`,
  },
];
