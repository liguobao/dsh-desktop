(() => {
  const api = window.dshExtensionManager
  const { actionButton, errorText, setFeedback, textElement, toggleButton, zh } = window.dshManagerUi
  const strings = zh ? {
    documentTitle: 'DSH Skills', appTitle: 'Skills', surfaceLabel: 'Skills', refresh: '刷新', docs: '文档',
    pageTitle: 'Harness Skills',
    trust: 'Skills 会引导 Harness 使用工具，启用前请检查内容。', importExtension: '导入 Skill 文件夹…', openExtensions: '打开 Skills 目录',
    createLabel: '创建 Skill 模板', namePlaceholder: 'skill-name', descriptionPlaceholder: 'Harness 应在何时使用这个 Skill',
    create: '创建', creating: '创建中…', createHint: '创建 ~/.dsh/skills/<name>/SKILL.md；Harness 会自动监听此目录。',
    userExtensions: '用户 Skills', empty: '尚无用户 Skills。', count: count => `${count} 个用户 Skill`, managed: '管理目录', loading: '正在加载…',
    active: '已启用', inactive: '已停用', invalid: '格式无效', show: '定位', moveTrash: '移到废纸篓', enable: '启用', disable: '停用',
    confirmRemove: name => `把 ${name} 移到系统废纸篓吗？`, imported: 'Skill 已导入并启用。', created: 'Skill 模板已创建并启用。',
    changed: 'Skill 状态已更新。', removed: 'Skill 已移到系统废纸篓。', modelAndUser: '模型与用户均可调用', userOnly: '仅用户可调用', modelOnly: '仅模型可调用', notInvocable: '不可调用',
    unavailable: 'Skills 桥接不可用，请重新启动 DSH Desktop。', unavailableSummary: '不可用', unknownError: 'Skill 操作失败。',
  } : {
    documentTitle: 'DSH Skills', appTitle: 'Skills', surfaceLabel: 'Skills', refresh: 'Refresh', docs: 'Documentation',
    pageTitle: 'Harness Skills',
    trust: 'Skills can guide Harness tool use. Review them before enabling.', importExtension: 'Import Skill folder…', openExtensions: 'Open Skills folder',
    createLabel: 'Create a Skill template', namePlaceholder: 'skill-name', descriptionPlaceholder: 'When Harness should use this Skill',
    create: 'Create', creating: 'Creating…', createHint: 'Creates ~/.dsh/skills/<name>/SKILL.md. Harness watches this directory automatically.',
    userExtensions: 'User Skills', empty: 'No user Skills are installed.', count: count => `${count} user Skill${count === 1 ? '' : 's'}`, managed: 'Managed in', loading: 'Loading…',
    active: 'Enabled', inactive: 'Disabled', invalid: 'Invalid format', show: 'Show', moveTrash: 'Move to Trash', enable: 'Enable', disable: 'Disable',
    confirmRemove: name => `Move ${name} to the system Trash?`, imported: 'Skill imported and enabled.', created: 'Skill template created and enabled.',
    changed: 'Skill status updated.', removed: 'Skill moved to the system Trash.', modelAndUser: 'Model and user invocable', userOnly: 'User invocable only', modelOnly: 'Model invocable only', notInvocable: 'Not invocable',
    unavailable: 'The Skills bridge is unavailable. Restart DSH Desktop.', unavailableSummary: 'Unavailable', unknownError: 'Skill operation failed.',
  }

  const elements = {
    summary: document.querySelector('#extension-summary'),
    feedback: document.querySelector('#extension-feedback'),
    loading: document.querySelector('#extensions-loading'),
    list: document.querySelector('#extensions-list'),
    empty: document.querySelector('#extensions-empty'),
    name: document.querySelector('#extension-name'),
    description: document.querySelector('#extension-description'),
    create: document.querySelector('#extension-create'),
  }
  let busy = false
  let catalog = { skills: [] }

  function localize() {
    document.documentElement.lang = zh ? 'zh-CN' : 'en'
    document.title = strings.documentTitle
    document.querySelector('#app-title').textContent = strings.appTitle
    document.querySelector('#surface-label').textContent = strings.surfaceLabel
    document.querySelector('#refresh').textContent = strings.refresh
    document.querySelector('#docs').textContent = strings.docs
    document.querySelector('#page-title').textContent = strings.pageTitle
    document.querySelector('#extension-trust').textContent = strings.trust
    document.querySelector('#extension-import').textContent = strings.importExtension
    document.querySelector('#extensions-open-root').textContent = strings.openExtensions
    document.querySelector('#extension-create-label').textContent = strings.createLabel
    elements.name.placeholder = strings.namePlaceholder
    elements.description.placeholder = strings.descriptionPlaceholder
    elements.create.textContent = strings.create
    document.querySelector('#extension-create-hint').textContent = strings.createHint
    document.querySelector('#extensions-heading').textContent = strings.userExtensions
    document.querySelector('#extensions-note').textContent = `${strings.managed}: ~/.dsh/skills`
    elements.empty.textContent = strings.empty
    elements.summary.textContent = strings.loading
  }

  function setBusy(value, action = '') {
    busy = value
    document.body.setAttribute('aria-busy', String(value))
    for (const control of document.querySelectorAll('button, input')) control.disabled = value
    elements.create.textContent = value && action === 'create' ? strings.creating : strings.create
  }

  function invocation(extension) {
    if (extension.modelInvocable && extension.userInvocable) return strings.modelAndUser
    if (extension.userInvocable) return strings.userOnly
    if (extension.modelInvocable) return strings.modelOnly
    return strings.notInvocable
  }

  function extensionRow(extension) {
    const row = document.createElement('div')
    row.className = 'item-row'
    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('div')
    title.className = 'item-title'
    title.append(textElement('span', 'item-name', extension.name))
    main.append(title)
    if (extension.description) main.append(textElement('p', 'item-description', extension.description))
    main.append(textElement('div', 'item-meta', extension.valid ? `${extension.format === 'file' ? 'Markdown' : 'SKILL.md'} · ${invocation(extension)}` : extension.error))
    const actions = document.createElement('div')
    actions.className = 'item-actions'
    actions.append(textElement('span', `status${extension.valid ? extension.enabled ? '' : ' status--off' : ' status--warning'}`, extension.valid ? extension.enabled ? strings.active : strings.inactive : strings.invalid))
    if (extension.valid) actions.append(toggleButton(extension.enabled, `${extension.enabled ? strings.disable : strings.enable} ${extension.name}`, () => void changeEnabled(extension.entry, !extension.enabled)))
    actions.append(actionButton(strings.show, 'button button--small', () => void reveal(extension.entry, extension.enabled)))
    actions.append(actionButton(strings.moveTrash, 'button button--danger button--small', () => void remove(extension)))
    row.append(main, actions)
    return row
  }

  function render() {
    elements.loading.hidden = true
    elements.summary.textContent = strings.count(catalog.skills.length)
    document.querySelector('#extensions-note').textContent = `${strings.managed}: ${catalog.activeDir ?? '~/.dsh/skills'}`
    elements.list.replaceChildren(...catalog.skills.map(extension => extensionRow(extension)))
    elements.list.hidden = catalog.skills.length === 0
    elements.empty.hidden = catalog.skills.length !== 0
  }

  async function load() {
    if (!api) {
      elements.loading.hidden = true
      elements.summary.textContent = strings.unavailableSummary
      return setFeedback(elements.feedback, strings.unavailable, 'error')
    }
    const result = await api.list()
    if (!result?.ok) {
      elements.loading.hidden = true
      elements.summary.textContent = strings.unavailableSummary
      return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    }
    catalog = result.catalog
    render()
  }

  async function create(event) {
    event.preventDefault()
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true, 'create')
    const result = await api.create(elements.name.value, elements.description.value)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    elements.name.value = ''
    elements.description.value = ''
    setFeedback(elements.feedback, strings.created)
    render()
  }

  async function importExtension() {
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.importFolder()
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    if (result.cancelled) return
    catalog = result.catalog
    setFeedback(elements.feedback, strings.imported)
    render()
  }

  async function changeEnabled(entry, enabled) {
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.setEnabled(entry, enabled)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    setFeedback(elements.feedback, strings.changed)
    render()
  }

  async function reveal(entry, enabled) {
    const result = await api.reveal(entry, enabled)
    if (!result?.ok) setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
  }

  async function remove(extension) {
    if (busy || !confirm(strings.confirmRemove(extension.name))) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.remove(extension.entry, extension.enabled)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    setFeedback(elements.feedback, strings.removed)
    render()
  }

  localize()
  document.querySelector('#extension-create-form').addEventListener('submit', create)
  document.querySelector('#extension-import').addEventListener('click', () => void importExtension())
  document.querySelector('#extensions-open-root').addEventListener('click', async () => {
    const result = await api?.openRoot()
    if (!result?.ok) setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
  })
  document.querySelector('#refresh').addEventListener('click', () => void load())
  document.querySelector('#docs').addEventListener('click', () => void api?.openDocs())
  void load()
})()
