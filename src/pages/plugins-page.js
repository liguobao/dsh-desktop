(() => {
  const api = window.dshPluginManager
  const { actionButton, errorText, setFeedback, textElement, toggleButton, zh } = window.dshManagerUi
  const strings = zh ? {
    documentTitle: 'DSH 插件', appTitle: '插件', refresh: '刷新', docs: '文档',
    pageTitle: 'Harness 插件',
    trust: '插件会在本机以 Harness 的相同权限运行，请只安装你信任的代码。', installLabel: '从 npm 或 GitHub 安装',
    placeholder: '@scope/plugin@version 或 https://github.com/owner/repo', install: '安装', installing: '安装中…',
    hint: '支持 GitHub 仓库、Commit 和 Tree 地址；仓库地址默认安装最新 Tag。',
    buildLabel: '允许这个 GitHub 软件包运行安装和构建脚本；勾选前请先检查源码。', installed: '已安装插件', managed: '管理目录',
    empty: '尚未安装用户插件。', system: '系统 Bundle', systemNote: 'web profile 运行所必需', loading: '正在加载…',
    count: count => `${count} 个用户插件`, enabled: '已启用', disabled: '已停用', invalid: '不是 DSH 插件', missing: '文件缺失', bundled: '随 Harness 提供',
    enable: '启用', disable: '停用', update: '在线更新', updating: '正在获取默认分支最新版…', uninstall: '卸载', confirmRemove: name => `确定要卸载 ${name} 吗？`,
    restartText: '插件设置已更改，需要重启 Harness 后生效。', restart: '立即重启', restarting: '正在重启…',
    installedMessage: '插件安装完成。', updated: '插件已更新。', upToDate: '已是最新版本。', removed: '插件已卸载。', changed: '插件状态已更新。',
    buildSkipped: '仓库需要运行构建脚本，当前插件尚未启用。检查源码后，勾选构建脚本授权并重新安装。',
    unavailable: '插件管理桥接不可用，请重新启动 DSH Desktop。', unavailableSummary: '不可用', unknownError: '插件操作失败。',
  } : {
    documentTitle: 'DSH Plugins', appTitle: 'Plugins', refresh: 'Refresh', docs: 'Documentation',
    pageTitle: 'Harness Plugins',
    trust: 'Plugins run locally with the same permissions as Harness. Install only code you trust.', installLabel: 'Install from npm or GitHub',
    placeholder: '@scope/plugin@version or https://github.com/owner/repo', install: 'Install', installing: 'Installing…',
    hint: 'Supports GitHub repository, commit, and tree URLs. Repository URLs install the latest tag.',
    buildLabel: 'Allow this GitHub package to run install and build scripts. Review its source first.', installed: 'Installed plugins', managed: 'Managed in',
    empty: 'No user plugins are installed.', system: 'System bundles', systemNote: 'Required by the web profile', loading: 'Loading…',
    count: count => `${count} user plugin${count === 1 ? '' : 's'}`, enabled: 'Enabled', disabled: 'Disabled', invalid: 'Not a DSH plugin', missing: 'Files missing', bundled: 'Bundled with Harness',
    enable: 'Enable', disable: 'Disable', update: 'Update online', updating: 'Fetching the latest default branch…', uninstall: 'Uninstall', confirmRemove: name => `Uninstall ${name}?`,
    restartText: 'Plugin settings changed. Restart Harness to apply them.', restart: 'Restart now', restarting: 'Restarting…',
    installedMessage: 'Plugin installed.', updated: 'Plugin updated.', upToDate: 'Already up to date.', removed: 'Plugin uninstalled.', changed: 'Plugin status updated.',
    buildSkipped: 'This repository requires build scripts, so the plugin was not enabled. Review the source, allow build scripts, and install it again.',
    unavailable: 'The plugin manager bridge is unavailable. Restart DSH Desktop.', unavailableSummary: 'Unavailable', unknownError: 'Plugin operation failed.',
  }

  const elements = {
    summary: document.querySelector('#plugin-summary'),
    spec: document.querySelector('#plugin-spec'),
    form: document.querySelector('#plugin-install-form'),
    install: document.querySelector('#plugin-install'),
    allowBuild: document.querySelector('#allow-build'),
    buildOption: document.querySelector('#build-option'),
    feedback: document.querySelector('#plugin-feedback'),
    restartBanner: document.querySelector('#restart-banner'),
    restart: document.querySelector('#restart'),
    loading: document.querySelector('#plugin-loading'),
    list: document.querySelector('#plugin-list'),
    empty: document.querySelector('#plugin-empty'),
    system: document.querySelector('#system-list'),
  }
  let busy = false
  let restartRequired = false
  let catalog = { plugins: [], system: [] }

  function localize() {
    document.documentElement.lang = zh ? 'zh-CN' : 'en'
    document.title = strings.documentTitle
    document.querySelector('#app-title').textContent = strings.appTitle
    document.querySelector('#refresh').textContent = strings.refresh
    document.querySelector('#docs').textContent = strings.docs
    document.querySelector('#page-title').textContent = strings.pageTitle
    document.querySelector('#plugin-trust').textContent = strings.trust
    document.querySelector('#plugin-install-label').textContent = strings.installLabel
    elements.spec.placeholder = strings.placeholder
    elements.install.textContent = strings.install
    document.querySelector('#plugin-install-hint').textContent = strings.hint
    document.querySelector('#allow-build-label').textContent = strings.buildLabel
    document.querySelector('#installed-heading').textContent = strings.installed
    document.querySelector('#installed-note').textContent = `${strings.managed}: ~/.dsh/profiles/web`
    elements.empty.textContent = strings.empty
    document.querySelector('#system-heading').textContent = strings.system
    document.querySelector('#system-note').textContent = strings.systemNote
    document.querySelector('#restart-text').textContent = strings.restartText
    elements.restart.textContent = strings.restart
    elements.summary.textContent = strings.loading
  }

  function setBusy(value, action = '') {
    busy = value
    document.body.setAttribute('aria-busy', String(value))
    for (const control of document.querySelectorAll('button, input')) control.disabled = value
    elements.install.textContent = value && action === 'install' ? strings.installing : strings.install
  }

  function pluginRow(plugin, system = false) {
    const row = document.createElement('div')
    row.className = 'item-row'
    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('div')
    title.className = 'item-title'
    title.append(textElement('span', 'item-name', plugin.name))
    if (plugin.version) title.append(textElement('span', 'item-version', `v${plugin.version}`))
    main.append(title)
    if (plugin.description) main.append(textElement('p', 'item-description', plugin.description))
    main.append(textElement('div', 'item-meta', system ? strings.bundled : `${plugin.source === 'github' ? 'GitHub' : 'npm'} · ${plugin.requested || 'npm'}`))
    const actions = document.createElement('div')
    actions.className = 'item-actions'
    if (system) actions.append(textElement('span', 'status', strings.enabled))
    else if (!plugin.installed) actions.append(textElement('span', 'status status--warning', strings.missing))
    else if (!plugin.bundle) actions.append(textElement('span', 'status status--warning', strings.invalid))
    else {
      actions.append(textElement('span', `status${plugin.enabled ? '' : ' status--off'}`, plugin.enabled ? strings.enabled : strings.disabled))
      actions.append(toggleButton(plugin.enabled, `${plugin.enabled ? strings.disable : strings.enable} ${plugin.name}`, () => void changeEnabled(plugin.name, !plugin.enabled)))
    }
    if (!system && plugin.source === 'github' && plugin.installed) {
      actions.append(actionButton(strings.update, 'button button--small', () => void update(plugin.name)))
    }
    if (!system) actions.append(actionButton(strings.uninstall, 'button button--danger button--small', () => void uninstall(plugin.name)))
    row.append(main, actions)
    return row
  }

  function render() {
    elements.loading.hidden = true
    elements.summary.textContent = strings.count(catalog.plugins.length)
    document.querySelector('#installed-note').textContent = `${strings.managed}: ${catalog.profileDir ?? '~/.dsh/profiles/web'}`
    elements.list.replaceChildren(...catalog.plugins.map(plugin => pluginRow(plugin)))
    elements.list.hidden = catalog.plugins.length === 0
    elements.empty.hidden = catalog.plugins.length !== 0
    elements.system.replaceChildren(...catalog.system.map(plugin => pluginRow(plugin, true)))
    elements.restartBanner.dataset.visible = String(restartRequired)
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

  async function install(event) {
    event.preventDefault()
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true, 'install')
    const result = await api.install(elements.spec.value, elements.allowBuild.checked)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    if (catalog.buildScriptsIgnored) {
      elements.buildOption.hidden = false
      setFeedback(elements.feedback, strings.buildSkipped, 'error')
    } else {
      restartRequired = true
      elements.spec.value = ''
      elements.allowBuild.checked = false
      elements.buildOption.hidden = true
      setFeedback(elements.feedback, strings.installedMessage)
    }
    render()
  }

  async function changeEnabled(name, enabled) {
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.setEnabled(name, enabled)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    restartRequired = true
    setFeedback(elements.feedback, strings.changed)
    render()
  }

  async function update(name) {
    if (busy) return
    setFeedback(elements.feedback, strings.updating)
    setBusy(true)
    const result = await api.update(name)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    if (catalog.upToDate) {
      setFeedback(elements.feedback, strings.upToDate)
    } else {
      restartRequired = true
      setFeedback(elements.feedback, catalog.buildScriptsIgnored ? strings.buildSkipped : strings.updated, catalog.buildScriptsIgnored ? 'error' : 'info')
    }
    render()
  }

  async function uninstall(name) {
    if (busy || !confirm(strings.confirmRemove(name))) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.remove(name)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    restartRequired = true
    setFeedback(elements.feedback, strings.removed)
    render()
  }

  async function restart() {
    if (busy) return
    setBusy(true)
    elements.restart.textContent = strings.restarting
    const result = await api.restart()
    if (!result?.ok) {
      setBusy(false)
      elements.restart.textContent = strings.restart
      return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    }
    window.close()
  }

  localize()
  elements.form.addEventListener('submit', install)
  elements.spec.addEventListener('input', () => {
    const github = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)/i.test(elements.spec.value.trim())
    elements.buildOption.hidden = !github
    if (!github) elements.allowBuild.checked = false
  })
  elements.restart.addEventListener('click', restart)
  document.querySelector('#refresh').addEventListener('click', () => void load())
  document.querySelector('#docs').addEventListener('click', () => void api?.openDocs())
  void load()
})()
