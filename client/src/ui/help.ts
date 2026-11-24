// 帮助弹窗 ("?")：Agent Party 实时虚拟办公室、宝可梦决斗场、捏脸接入、状态图例与快捷键说明。
import type { AgentStatus } from '../../../shared/types';
import type { HelpSection } from './context';
import { h, iconButton, prefersReducedMotion } from './dom';
import { ICONS } from './icons';
import { STATUS_LABEL } from './model';
import { tr } from '../../../shared/i18n';

const STATUS_HELP: [AgentStatus, string][] = [
  ['working', '坐在工位电脑前，正在分析或执行任务。'],
  ['waiting', '举手提示：正在等待你的确认、审批或下一步指令。'],
  ['idle', '完成本轮任务，在办公室或休息区自由走动、互动摸鱼。'],
  ['offline', '长期离线或会话关闭后乘电梯离开办公室。'],
];

const ARENA_HELP: [string, string][] = [
  ['⚔️', '宝可梦决斗场（右下角）：具备参赛资格的角色（默认所有宝可梦开启）每隔 2 分钟自动匹配 2 名选手展开 60 秒对决，其余闲逛角色也会前去围观喝彩。'],
  ['📺', '挂壁倒计时电视：场地入口右侧墙上实时显示下一场开赛倒计时或本场剩余秒数。'],
  ['🏆', '本小时决斗榜：右下角展示胜负战绩，每逢北京时间（UTC+8）整点自动重置清零。'],
  ['🎁', '后台彩蛋开关：管理员可在「管理后台 (/admin)」单独给像素小人或普通桌宠开启「参战」开关，让人类程序员也能上台 PK！'],
];

const ONBOARDING_HELP: [string, string][] = [
  ['🤖', '点击顶部「+ 接入 AI」（/setup）获取一句话指令，任何 AI 编程工具（Claude Code、Codex、Antigravity、Cursor、Windsurf、Trae、WorkBuddy、豆包等）都能自动完成配置。'],
  ['🎨', '像素小人捏脸（/customize）：可自由定制发型、发色、服饰搭配、配饰与伴随宝可梦；支持在页面一键同步后台，或复制 AP1:... 捏脸代码粘贴给你的 AI 随时换装。'],
  ['🐾', '伴随宠物子菜单：你携带的宝可梦或桌宠会嵌套显示在左侧边栏你的名字下方，平时跟着一起工作或参加决斗。'],
  ['🔒', '隐私与时区：客户端仅同步 working / waiting / idle 状态与工具名，绝不读取或上传任何代码与对话内容；昼夜光照与挂钟统一按北京时间（UTC+8）运行。'],
];

const SOCIAL_HELP: [string, string][] = [
  ['📺', '休息区电视：大家会聚在沙发看足球赛（进球一起欢呼）、追剧并捧着爆米花闲聊。'],
  ['🎮', '主机与街机：闲暇时在沙发搓手柄或到双人街机 PK。'],
  ['🏓', '乒乓球桌：5 分制对战与围观喝彩，输赢还有记分牌与趣味弹幕。'],
  ['☕', '茶水间与娱乐：现磨咖啡、饮水机、零食机、石头剪刀布与浴室照镜子。'],
];

const SHORTCUTS: [string[], string][] = [
  [['/'], '聚焦搜索在线成员、伴随宠物或房间'],
  [['F'], '视角跟随当前选中的角色'],
  [['O', '0'], '重置镜头俯瞰整个虚拟办公室大楼'],
  [['Esc'], '取消当前选中的角色或房间焦点'],
  [['['], '展开 / 收起左侧在线成员名单栏'],
  [[']'], '展开 / 收起实时动态栏'],
  [['←', '↑', '→', '↓'], '平移镜头（也支持 W A S D）'],
  [['+', '−'], '放大 / 缩小视图（也支持鼠标滚轮）'],
  [['?'], '打开本使用说明'],
];

function keys(list: string[]): HTMLElement {
  return h('span', { class: 'ui-keys' }, ...list.map((k) => h('kbd', { class: 'ui-kbd', text: k })));
}

export class HelpDialog {
  readonly el: HTMLDialogElement;
  private sections = new Map<HelpSection, HTMLElement>();

  constructor() {
    const close = iconButton(ICONS.close, tr('Fechar ajuda'), () => this.el.close(), 'ui-icon-btn--sm');
    const bullet = (icon: string, text: string) =>
      h('li', {}, h('span', { class: 'ui-icon-legend__icon', text: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text }));

    const statusList = h(
      'ul',
      { class: 'ui-legend' },
      ...STATUS_HELP.map(([s, text]) =>
        h('li', {}, h('span', { class: `ui-status-dot is-${s}`, attrs: { 'aria-hidden': 'true' } }), h('strong', { text: STATUS_LABEL[s] }), h('span', { text })),
      ),
    );
    const shortcuts = h('dl', { class: 'ui-shortcuts' }, ...SHORTCUTS.flatMap(([k, text]) => [h('dt', {}, keys(k)), h('dd', { text })]));

    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-help', attrs: { 'aria-labelledby': 'ui-help-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: 'Agent Party 使用指南', attrs: { id: 'ui-help-title' } }), close),
      h(
        'div',
        { class: 'ui-dialog__body' },
        h(
          'section',
          { class: 'ui-help__intro' },
          h('p', {
            text: 'Agent Party 是一个实时多人 AI 虚拟办公室：每位成员都会以专属像素小人或宠物形象入住工位，实时联动你在各类 AI 编程工具中的工作与摸鱼状态。',
          }),
        ),
        h('section', {}, h('h3', { text: '成员状态图例' }), statusList),
        h('section', { class: 'ui-help__shell' }, h('h3', { text: '⚡ 宝可梦决斗场' }), h('ul', { class: 'ui-shell-legend' }, ...ARENA_HELP.map(([i, t]) => bullet(i, t)))),
        h('section', { class: 'ui-help__shell' }, h('h3', { text: '🤖 接入 AI、捏脸与隐私安全' }), h('ul', { class: 'ui-shell-legend' }, ...ONBOARDING_HELP.map(([i, t]) => bullet(i, t)))),
        h('section', { class: 'ui-help__shell' }, h('h3', { text: '🎮 办公室休闲互动' }), h('ul', { class: 'ui-shell-legend' }, ...SOCIAL_HELP.map(([i, t]) => bullet(i, t)))),
        h(
          'section',
          {},
          h('h3', { text: '🖱️ 视角操控与快捷键' }),
          h(
            'ul',
            { class: 'ui-help__list' },
            h('li', { text: '鼠标左键拖拽可平移画面，滚轮或双指捏合可缩放场景。' }),
            h('li', { text: '单击任意小人/宠物/房间可查看右侧详情面板，双击即可一键聚焦放大。' }),
            h('li', { text: '全局外观设置（节日主题、昼夜光照、名字/气泡显示等）由管理员在右上角「管理 (/admin)」统一配置。' }),
          ),
          shortcuts,
        ),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(section?: HelpSection): void {
    if (!this.el.open) this.el.showModal();
    const target = section ? this.sections.get(section) : undefined;
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      target.classList.remove('is-highlight');
      void target.offsetWidth;
      target.classList.add('is-highlight');
      const heading = target.querySelector<HTMLElement>('h3');
      heading?.focus({ preventScroll: true });
    });
  }

  get isOpen(): boolean {
    return this.el.open;
  }
}
