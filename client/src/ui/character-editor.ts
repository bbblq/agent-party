// 形象编辑器：支持切换「⚡ 宝可梦 (SpriteCollab)」「🐾 Codex V2 桌宠」与「🧑 像素小人」
import { NAME_MAX } from '../../../shared/appearance';
import { tr } from '../../../shared/i18n';
import type { AgentInfo } from '../../../shared/types';
import { appearanceFromSeed } from '../art';
import type { Appearance } from '../art/api';
import { access } from '../net/access';
import type { PetCatalogItem, PokemonSearchItem } from '../net/store';
import { loadPetAvatarUrl } from '../world/render/pet-sprites';
import { AppearanceFields } from './appearance-fields';
import { canEditCharacter, changedParts } from './character-model';
import type { UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { ICONS } from './icons';

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export class CharacterEditor {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private agentId = '';
  private editId = 0;
  private editing = false;
  private busy = false;
  private confirmingReset = false;
  private seed = 0;
  private look: 'f' | 'm' = 'f';
  private base: Appearance | null = null;
  private mode: 'pokemon' | 'pet' | 'human' = 'human';
  private selectedPetId: string | null = null;
  private selectedPokemonId: string | null = null;
  private pets: PetCatalogItem[] = [];
  private petsLoaded = false;
  private pokeLoaded = false;

  private readonly fields = new AppearanceFields();
  private readonly nameInput: HTMLInputElement;
  private readonly roleInput: HTMLInputElement;
  private readonly pokeTabBtn: HTMLButtonElement;
  private readonly petTabBtn: HTMLButtonElement;
  private readonly humanTabBtn: HTMLButtonElement;
  private readonly pokePane: HTMLElement;
  private readonly petPane: HTMLElement;
  private readonly humanPane: HTMLElement;
  private readonly pokeInput: HTMLInputElement;
  private readonly pokeList: HTMLElement;
  private readonly pokeStatus: HTMLElement;
  private readonly petGrid: HTMLElement;
  private readonly upIdInput: HTMLInputElement;
  private readonly upNameInput: HTMLInputElement;
  private readonly upSpriteInput: HTMLInputElement;
  private readonly upJsonInput: HTMLInputElement;
  private readonly upBtn: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;

  constructor(private ctx: UiContext) {
    this.button = iconButton(ICONS.pencil, tr('Editar personagem'), () => (this.editing ? this.cancel() : this.start()), 'ui-icon-btn--sm ui-char-edit');
    setAttr(this.button, 'aria-expanded', 'false');
    this.button.hidden = true;

    this.nameInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: NAME_MAX, autocomplete: 'off', spellcheck: 'false' } });
    this.roleInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: 32, autocomplete: 'off', spellcheck: 'false', placeholder: '角色 / 签名' } });

    this.pokeTabBtn = h('button', { class: 'ui-char-tab', type: 'button', text: '⚡ 宝可梦', on: { click: () => this.switchMode('pokemon') } });
    this.petTabBtn = h('button', { class: 'ui-char-tab', type: 'button', text: '🐾 Codex V2', on: { click: () => this.switchMode('pet') } });
    this.humanTabBtn = h('button', { class: 'ui-char-tab', type: 'button', text: '🧑 像素小人', on: { click: () => this.switchMode('human') } });
    const tabs = h('div', { class: 'ui-char-tabs' }, this.pokeTabBtn, this.petTabBtn, this.humanTabBtn);

    // ---- Pokémon Pane (SpriteCollab PMD)
    this.pokeInput = h('input', {
      class: 'ui-char__name',
      type: 'search',
      attrs: { placeholder: '搜索宝可梦（如：皮卡丘 / 耿鬼 / 25）', autocomplete: 'off', spellcheck: 'false' },
    });
    const pokeSearchBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: '搜索', on: { click: () => void this.refreshPokemon(this.pokeInput.value) } });
    this.pokeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void this.refreshPokemon(this.pokeInput.value);
      }
    });
    this.pokeList = h('div', { class: 'ui-poke-list' });
    this.pokeStatus = h('p', { class: 'ui-muted ui-small', text: '点击任意宝可梦即可从 SpriteCollab 拉取多角度像素动画。' });
    this.pokePane = h(
      'div',
      { class: 'ui-poke-pane' },
      h('div', { class: 'ui-poke-search' }, this.pokeInput, pokeSearchBtn),
      this.pokeList,
      this.pokeStatus,
    );

    // ---- Codex V2 Pet Pane
    this.petGrid = h('div', { class: 'ui-pet-grid' });
    this.upIdInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { placeholder: 'petId (如 pikachu)', maxlength: 48 } });
    this.upNameInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { placeholder: '显示名称（可选）', maxlength: 48 } });
    this.upSpriteInput = h('input', { type: 'file', attrs: { accept: '.webp,.png,image/webp,image/png' } });
    this.upJsonInput = h('input', { type: 'file', attrs: { accept: '.json,application/json' } });
    this.upBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: '上传并应用', on: { click: () => void this.uploadPet() } });
    const uploadBox = h(
      'div',
      { class: 'ui-pet-upload' },
      h('p', { class: 'ui-muted ui-small', text: '上传本地 Codex V2 桌宠（spritesheet.webp / .png + 可选 pet.json）：' }),
      h('div', { class: 'ui-pet-upload__row' }, this.upIdInput, this.upNameInput),
      h('label', { class: 'ui-pet-upload__file' }, h('span', { text: '图集 (.webp / .png)：' }), this.upSpriteInput),
      h('label', { class: 'ui-pet-upload__file' }, h('span', { text: '配置 (pet.json，可选)：' }), this.upJsonInput),
      this.upBtn,
    );
    this.petPane = h('div', { class: 'ui-pet-pane' }, this.petGrid, uploadBox);

    // ---- Human Pane
    const roll = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Sortear'), title: tr('Sortear outra aparência (desfaz as peças escolhidas)'), on: { click: () => this.roll() } });
    this.humanPane = h(
      'div',
      { class: 'ui-human-pane' },
      h(
        'div',
        { class: 'ui-char__top' },
        this.fields.preview,
        h('div', { class: 'ui-char__head' }, roll),
      ),
      this.fields.groups,
    );

    this.error = h('p', { class: 'ui-char__error', role: 'alert', hidden: true });
    this.saveBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => void this.save() } });
    const cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.cancel() } });
    this.resetBtn = h('button', { class: 'ui-link-btn ui-char__reset', type: 'button', text: tr('Voltar ao sorteio'), on: { click: () => void this.reset() } });

    this.el = h(
      'section',
      { class: 'ui-char', hidden: true, attrs: { 'aria-label': tr('Editar personagem') }, on: { keydown: (ev) => this.onKey(ev) } },
      h(
        'div',
        { class: 'ui-char__meta' },
        h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome') }), this.nameInput),
        h('label', { class: 'ui-char__label' }, h('span', { text: '角色 / 签名' }), this.roleInput),
      ),
      tabs,
      this.pokePane,
      this.petPane,
      this.humanPane,
      this.error,
      h('div', { class: 'ui-char__actions' }, this.saveBtn, cancel, this.resetBtn),
    );
  }

  open(id: string): void {
    if (id !== this.agentId) this.close();
    this.agentId = id;
  }

  render(a: AgentInfo, live: boolean): void {
    const store = this.ctx.store;
    const allowed = canEditCharacter(a, {
      live,
      terminal: !!store.snapshot?.meta.terminal,
      local: access().local,
      replaying: store.replaying,
      mock: store.mock,
      admin: store.isAdmin,
    });
    setHidden(this.button, !allowed);
    if (this.editing && !allowed) {
      this.close();
      if (!live || a.status === 'offline') this.ctx.announce(tr('O agente saiu do escritório.'));
    }
    if (this.editing && !this.confirmingReset) setHidden(this.resetBtn, !a.custom && !a.pet);
  }

  private switchMode(next: 'pokemon' | 'pet' | 'human'): void {
    this.mode = next;
    this.pokeTabBtn.classList?.toggle?.('is-active', next === 'pokemon');
    this.petTabBtn.classList?.toggle?.('is-active', next === 'pet');
    this.humanTabBtn.classList?.toggle?.('is-active', next === 'human');
    setHidden(this.pokePane, next !== 'pokemon');
    setHidden(this.petPane, next !== 'pet');
    setHidden(this.humanPane, next !== 'human');
    if (next === 'pet' && !this.petsLoaded) void this.refreshPets();
    if (next === 'pokemon' && !this.pokeLoaded) void this.refreshPokemon('');
  }

  private async refreshPokemon(query: string): Promise<void> {
    this.pokeLoaded = true;
    const items = await this.ctx.store.searchPokemon(query.trim());
    this.renderPokemonList(items);
  }

  private renderPokemonList(items: PokemonSearchItem[]): void {
    this.pokeList.replaceChildren();
    if (!items.length) {
      this.pokeList.append(h('span', { class: 'ui-muted ui-small', text: '未找到匹配的宝可梦。' }));
      return;
    }
    for (const p of items.slice(0, 18)) {
      const petId = `pmd:${p.dex}`;
      const chip = h('button', {
        class: `ui-poke-chip${this.selectedPokemonId === petId ? ' is-selected' : ''}`,
        type: 'button',
        text: `#${p.dex} ${p.zh_hans ?? p.en}`,
        on: { click: () => void this.pickPokemon(p) },
      });
      this.pokeList.append(chip);
    }
  }

  private async pickPokemon(p: PokemonSearchItem): Promise<void> {
    this.showError(null);
    setText(this.pokeStatus, `正在加载 ${p.zh_hans ?? p.en} (#${p.dex}) 的多角度动作素材…`);
    const res = await this.ctx.store.selectPokemon(p.dex);
    if (res.error || !res.pet) {
      setText(this.pokeStatus, res.error ?? '加载失败');
      return this.showError(res.error ?? '加载宝可梦素材失败');
    }
    this.selectedPokemonId = res.pet.id;
    setText(this.pokeStatus, `✅ 已准备就绪：${res.pet.displayName ?? p.en}，点击“保存”即可变身！`);
    this.renderPokemonList(await this.ctx.store.searchPokemon(this.pokeInput.value.trim()));
  }

  private async refreshPets(): Promise<void> {
    this.petsLoaded = true;
    this.pets = await this.ctx.store.fetchPets();
    this.renderPetGrid();
  }

  private renderPetGrid(): void {
    this.petGrid.replaceChildren();
    if (!this.pets.length) {
      this.petGrid.append(h('p', { class: 'ui-muted ui-small', text: '暂未发现 Codex V2 桌宠，可以在下方直接上传。' }));
      return;
    }
    if (!this.selectedPetId || !this.pets.some((p) => p.id === this.selectedPetId)) {
      this.selectedPetId = this.pets[0].id;
    }
    for (const p of this.pets) {
      const thumb = h('img', { class: 'ui-pet-thumb', attrs: { alt: p.displayName ?? p.id, draggable: 'false' } });
      const ready = loadPetAvatarUrl(p.spriteUrl, p.spec, (url) => {
        thumb.src = url;
      }, p.pmd);
      if (ready) thumb.src = ready;
      const card = h(
        'button',
        {
          class: `ui-pet-card${p.id === this.selectedPetId ? ' is-selected' : ''}`,
          type: 'button',
          on: {
            click: () => {
              this.selectedPetId = p.id;
              this.renderPetGrid();
            },
          },
        },
        thumb,
        h('span', { class: 'ui-pet-card__name', text: p.displayName ?? p.id }),
      );
      this.petGrid.append(card);
    }
  }

  private start(): void {
    const a = this.ctx.agent(this.agentId);
    if (!a) return;
    this.editId++;
    this.seed = a.seed;
    this.look = a.look;
    this.base = appearanceFromSeed(a.seed, { look: a.look });
    this.nameInput.value = a.name;
    this.roleInput.value = a.role ?? '';
    this.selectedPokemonId = a.pet?.kind === 'pmd' ? a.pet.id : null;
    this.selectedPetId = a.pet?.kind !== 'pmd' ? (a.pet?.id ?? null) : null;
    this.confirmingReset = false;
    setText(this.resetBtn, tr('Voltar ao sorteio'));
    setHidden(this.resetBtn, !a.custom && !a.pet);
    this.showError(null);
    this.editing = true;
    setHidden(this.el, false);
    setAttr(this.button, 'aria-expanded', 'true');
    this.fields.set({ ...this.base, ...a.parts });
    this.petsLoaded = false;
    this.pokeLoaded = false;
    if (a.pet?.kind === 'pmd') {
      setText(this.pokeStatus, `当前宝可梦：${a.pet.displayName ?? a.pet.id}`);
      this.switchMode('pokemon');
    } else if (a.pet) {
      this.switchMode('pet');
    } else {
      this.switchMode('human');
    }
    this.nameInput.focus();
  }

  close(): void {
    if (!this.editing) return;
    this.editing = false;
    this.busy = false;
    this.saveBtn.disabled = false;
    setHidden(this.el, true);
    setAttr(this.button, 'aria-expanded', 'false');
  }

  private cancel(): void {
    this.close();
    this.button.focus();
  }

  private roll(): void {
    this.seed = randomSeed();
    this.base = appearanceFromSeed(this.seed, { look: this.look });
    this.fields.set({ ...this.base });
  }

  private async uploadPet(): Promise<void> {
    const sprite = this.upSpriteInput.files?.[0];
    if (!sprite) return this.showError('请先选择桌宠图集文件（.webp 或 .png）。');
    const rawId = this.upIdInput.value.trim() || sprite.name.replace(/\.[^.]+$/, '');
    const petId = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!petId) return this.showError('请填写有效的英文 petId。');

    const fd = new FormData();
    fd.append('petId', petId);
    if (this.upNameInput.value.trim()) fd.append('displayName', this.upNameInput.value.trim());
    fd.append('sprite', sprite);
    const jsonFile = this.upJsonInput.files?.[0];
    if (jsonFile) fd.append('petJson', jsonFile);

    this.upBtn.disabled = true;
    this.showError(null);
    const res = await this.ctx.store.uploadPet(fd);
    this.upBtn.disabled = false;
    if (res.error || !res.pet) {
      return this.showError(res.error ?? '上传失败');
    }
    this.upIdInput.value = '';
    this.upNameInput.value = '';
    this.upSpriteInput.value = '';
    this.upJsonInput.value = '';
    this.selectedPetId = res.pet.id;
    await this.refreshPets();
    this.switchMode('pet');
  }

  private async save(): Promise<void> {
    const draft = this.fields.value;
    if (this.busy || !this.base || !draft) return;
    const name = this.nameInput.value.trim();
    if (!name) return this.showError(tr('Dê um nome ao personagem.'));

    const chosenPetId = this.mode === 'pokemon' ? this.selectedPokemonId : this.mode === 'pet' ? this.selectedPetId : null;
    if ((this.mode === 'pokemon' || this.mode === 'pet') && !chosenPetId) {
      return this.showError(this.mode === 'pokemon' ? '请先点选一只宝可梦。' : '请选择一个 Codex V2 桌宠，或切换到其他模式。');
    }

    const id = this.agentId;
    const editId = this.editId;
    this.busy = true;
    this.saveBtn.disabled = true;
    const err = await this.ctx.store.saveCharacter(id, {
      name,
      role: this.roleInput.value.trim() || undefined,
      seed: this.seed,
      parts: changedParts(this.base, draft),
      avatarMode: this.mode === 'human' ? 'human' : 'pet',
      petId: chosenPetId,
    });
    if (!this.editing || this.agentId !== id || this.editId !== editId) return;
    this.busy = false;
    this.saveBtn.disabled = false;
    if (err) return this.showError(err);
    this.close();
    this.button.focus();
    this.ctx.announce(tr('Personagem salvo: {0}.', [name]));
  }

  private async reset(): Promise<void> {
    if (this.busy) return;
    if (!this.confirmingReset) {
      this.confirmingReset = true;
      setText(this.resetBtn, tr('Confirmar: voltar ao sorteio'));
      return;
    }
    const id = this.agentId;
    const editId = this.editId;
    this.busy = true;
    const err = await this.ctx.store.resetCharacter(id);
    if (!this.editing || this.agentId !== id || this.editId !== editId) return;
    this.busy = false;
    if (err) return this.showError(err);
    this.close();
    this.button.focus();
    this.ctx.announce(tr('O personagem voltou ao sorteio.'));
  }

  private showError(message: string | null): void {
    setText(this.error, message ?? '');
    setHidden(this.error, !message);
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.cancel();
    } else if (ev.key === 'Enter' && (ev.target === this.nameInput || ev.target === this.roleInput)) {
      ev.preventDefault();
      void this.save();
    }
  }
}
