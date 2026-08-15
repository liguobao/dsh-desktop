(() => {
  const api = window.dshPluginManager
  const { actionButton, errorText, setFeedback, textElement, toggleButton, zh } = window.dshManagerUi
  const strings = zh ? {
    documentTitle: 'DSH 插件', appTitle: '插件', refresh: '刷新', docs: '文档',
    pageTitle: 'Harness 插件',
    trust: '插件会在本机以 Harness 的相同权限运行，请只安装你信任的代码。', installLabel: '直接从 npm 或 GitHub 安装',
    placeholder: '@scope/plugin@version 或 https://github.com/owner/repo', install: '安装', installing: '安装中…',
    hint: '支持 GitHub 仓库、Commit 和 Tree 地址；仓库地址优先安装最新 Tag，没有 Tag 时固定到默认分支当前 Commit。',
    buildLabel: '允许这个 GitHub 软件包运行安装和构建脚本；勾选前请先检查源码。', installed: '已安装插件', managed: '管理目录',
    catalogEntryTitle: '在线插件', catalogEntryDescription: '浏览并搜索 GitHub 社区目录中的 DSH 插件。', catalogBrowse: '浏览目录 →', catalogBack: '← 返回插件管理',
    discover: '在线插件', discoverLoading: '正在加载在线目录…',
    discoverHint: '目录来源于 GitHub dsh-plugin topic；安装前请先检查插件源码。',
    searchLabel: '搜索社区插件', searchPlaceholder: '按名称、描述或分类搜索',
    onlineCatalog: count => `在线目录 · ${count} 个`, offlineCatalog: count => `离线目录 · ${count} 个`,
    resultCount: (shown, total) => total > shown ? `显示 ${shown}/${total} 个结果` : `${total} 个结果`,
    noMatches: '没有符合搜索条件的插件。', inspect: '查看源码', catalogInstall: '安装', catalogInstalled: '已安装',
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
    trust: 'Plugins run locally with the same permissions as Harness. Install only code you trust.', installLabel: 'Install directly from npm or GitHub',
    placeholder: '@scope/plugin@version or https://github.com/owner/repo', install: 'Install', installing: 'Installing…',
    hint: 'Supports GitHub repository, commit, and tree URLs. Repository URLs use the latest tag, or pin the current default-branch commit when no tag exists.',
    buildLabel: 'Allow this GitHub package to run install and build scripts. Review its source first.', installed: 'Installed plugins', managed: 'Managed in',
    catalogEntryTitle: 'Online plugins', catalogEntryDescription: 'Browse and search DSH plugins from the GitHub community catalog.', catalogBrowse: 'Browse catalog →', catalogBack: '← Back to plugin manager',
    discover: 'Online plugins', discoverLoading: 'Loading online catalog…',
    discoverHint: 'Cataloged from the GitHub dsh-plugin topic. Review a plugin\'s source before installing it.',
    searchLabel: 'Search community plugins', searchPlaceholder: 'Search by name, description, or category',
    onlineCatalog: count => `Online catalog · ${count}`, offlineCatalog: count => `Offline catalog · ${count}`,
    resultCount: (shown, total) => total > shown ? `Showing ${shown} of ${total} results` : `${total} result${total === 1 ? '' : 's'}`,
    noMatches: 'No plugins match this search.', inspect: 'View source', catalogInstall: 'Install', catalogInstalled: 'Installed',
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
    homeView: document.querySelector('#plugin-home-view'),
    homeNotices: document.querySelector('#home-notices'),
    catalogView: document.querySelector('#catalog-view'),
    catalogNotices: document.querySelector('#catalog-notices'),
    openCatalog: document.querySelector('#open-catalog'),
    closeCatalog: document.querySelector('#close-catalog'),
    catalogEntryNote: document.querySelector('#catalog-entry-note'),
    discoverNote: document.querySelector('#discover-note'),
    discoverHint: document.querySelector('#discover-hint'),
    discoverSearch: document.querySelector('#plugin-search'),
    discoverLoading: document.querySelector('#discover-loading'),
    discoverList: document.querySelector('#discover-list'),
    discoverEmpty: document.querySelector('#discover-empty'),
  }
  let busy = false
  let restartRequired = false
  let catalog = { plugins: [], system: [] }
  let discovery = { plugins: [], categories: {}, online: false, loaded: false }

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
    document.querySelector('#catalog-entry-title').textContent = strings.catalogEntryTitle
    document.querySelector('#catalog-entry-description').textContent = strings.catalogEntryDescription
    document.querySelector('#catalog-entry-action').textContent = strings.catalogBrowse
    elements.closeCatalog.textContent = strings.catalogBack
    document.querySelector('#discover-heading').textContent = strings.discover
    elements.discoverNote.textContent = strings.discoverLoading
    elements.discoverHint.textContent = strings.discoverHint
    document.querySelector('#plugin-search-label').textContent = strings.searchLabel
    elements.discoverSearch.placeholder = strings.searchPlaceholder
    elements.discoverEmpty.textContent = strings.noMatches
    document.querySelector('#installed-heading').textContent = strings.installed
    document.querySelector('#installed-note').textContent = `${strings.managed}: ~/.dsh/profiles/web`
    elements.empty.textContent = strings.empty
    document.querySelector('#system-heading').textContent = strings.system
    document.querySelector('#system-note').textContent = strings.systemNote
    document.querySelector('#restart-text').textContent = strings.restartText
    elements.restart.textContent = strings.restart
    elements.summary.textContent = strings.loading
  }

  function showCatalog() {
    setFeedback(elements.feedback)
    elements.catalogNotices.append(elements.feedback, elements.restartBanner)
    elements.homeView.hidden = true
    elements.catalogView.hidden = false
    elements.closeCatalog.focus()
  }

  function showHome() {
    setFeedback(elements.feedback)
    elements.homeNotices.append(elements.feedback, elements.restartBanner)
    elements.catalogView.hidden = true
    elements.homeView.hidden = false
    elements.openCatalog.focus()
  }

  function setBusy(value, action = '') {
    busy = value
    document.body.setAttribute('aria-busy', String(value))
    for (const control of document.querySelectorAll('button, input')) {
      control.disabled = value || control.dataset.alwaysDisabled === 'true'
    }
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

  function installedGitHubKey(requested) {
    const match = /^github:([^#]+)(?:#(.*))?$/i.exec(requested ?? '')
    if (match === null) return undefined
    const path = /(?:^|&)path:(\/[^&]+)$/i.exec(match[2] ?? '')?.[1] ?? ''
    return `${match[1].toLowerCase()}#${path}`
  }

  function discoveryPluginInstalled(plugin) {
    if (plugin.source === 'npm') return catalog.plugins.some(candidate => candidate.name === plugin.npm)
    const key = `${plugin.repository.toLowerCase()}#${plugin.path ?? ''}`
    return catalog.plugins.some(candidate => installedGitHubKey(candidate.requested) === key)
  }

  function categoryLabel(plugin) {
    const labels = discovery.categories[plugin.category]
    return labels?.[zh ? 'zh' : 'en'] || plugin.category
  }

  function discoveryRow(plugin) {
    const row = document.createElement('div')
    row.className = 'item-row discovery-row'
    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('div')
    title.className = 'item-title'
    const source = actionButton(plugin.name, 'catalog-link', () => void openSource(plugin.url))
    source.setAttribute('aria-label', `${strings.inspect}: ${plugin.repository}`)
    title.append(source, textElement('span', 'catalog-category', categoryLabel(plugin)))
    main.append(title)
    const description = plugin.description?.[zh ? 'zh' : 'en'] || plugin.description?.en
    if (description) main.append(textElement('p', 'item-description', description))
    const metadata = [plugin.repository, plugin.npm ? 'npm' : 'GitHub']
    if (Number.isSafeInteger(plugin.stars)) metadata.push(`★ ${String(plugin.stars)}`)
    main.append(textElement('div', 'item-meta', metadata.join(' · ')))

    const installed = discoveryPluginInstalled(plugin)
    const actions = document.createElement('div')
    actions.className = 'item-actions'
    actions.append(actionButton(strings.inspect, 'button button--small', () => void openSource(plugin.url)))
    const installButton = actionButton(installed ? strings.catalogInstalled : strings.catalogInstall, 'button button--primary button--small', () => void installCatalogPlugin(plugin))
    installButton.disabled = installed
    if (installed) installButton.dataset.alwaysDisabled = 'true'
    actions.append(installButton)
    row.append(main, actions)
    return row
  }

  function matchingDiscoveryPlugins(query) {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return discovery.plugins.filter(plugin => {
      const labels = discovery.categories[plugin.category] ?? {}
      const haystack = [
        plugin.name,
        plugin.owner,
        plugin.repository,
        plugin.description?.en,
        plugin.description?.zh,
        labels.en,
        labels.zh,
      ].filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    }).sort((left, right) => {
      const lowered = query.toLocaleLowerCase()
      const leftName = left.name.toLocaleLowerCase()
      const rightName = right.name.toLocaleLowerCase()
      const leftRank = lowered !== '' && leftName.startsWith(lowered) ? 1 : 0
      const rightRank = lowered !== '' && rightName.startsWith(lowered) ? 1 : 0
      return rightRank - leftRank || (right.stars ?? -1) - (left.stars ?? -1) || left.name.localeCompare(right.name)
    })
  }

  function renderDiscovery() {
    if (!discovery.loaded) return
    elements.discoverLoading.hidden = true
    elements.discoverSearch.disabled = false
    const query = elements.discoverSearch.value.trim()
    const matches = matchingDiscoveryPlugins(query)
    const limit = query === '' ? 20 : 40
    const visible = matches.slice(0, limit)
    const source = discovery.online ? strings.onlineCatalog(discovery.plugins.length) : strings.offlineCatalog(discovery.plugins.length)
    elements.catalogEntryNote.textContent = source
    elements.discoverNote.textContent = query === '' ? source : `${strings.resultCount(visible.length, matches.length)} · ${source}`
    elements.discoverList.replaceChildren(...visible.map(discoveryRow))
    elements.discoverList.hidden = visible.length === 0
    elements.discoverEmpty.hidden = visible.length !== 0
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
    renderDiscovery()
  }

  async function load() {
    elements.openCatalog.disabled = false
    if (!api) {
      elements.loading.hidden = true
      elements.summary.textContent = strings.unavailableSummary
      elements.catalogEntryNote.textContent = strings.unavailableSummary
      elements.openCatalog.disabled = true
      return setFeedback(elements.feedback, strings.unavailable, 'error')
    }
    elements.discoverLoading.hidden = false
    elements.discoverList.hidden = true
    elements.discoverEmpty.hidden = true
    elements.discoverSearch.disabled = true
    elements.catalogEntryNote.textContent = strings.discoverLoading
    elements.discoverNote.textContent = strings.discoverLoading
    const [result, discoveryResult] = await Promise.all([api.list(), api.discover()])
    if (!result?.ok) {
      elements.loading.hidden = true
      elements.summary.textContent = strings.unavailableSummary
      elements.catalogEntryNote.textContent = strings.unavailableSummary
      elements.openCatalog.disabled = true
      return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    }
    catalog = result.catalog
    if (discoveryResult?.ok) {
      discovery = {
        ...discoveryResult.catalog,
        online: discoveryResult.online === true,
        loaded: true,
      }
    } else {
      discovery = { plugins: [], categories: {}, online: false, loaded: true }
    }
    render()
  }

  async function installSpec(spec, allowBuildScripts) {
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true, 'install')
    const result = await api.install(spec, allowBuildScripts)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    if (catalog.buildScriptsIgnored) {
      elements.spec.value = spec
      elements.buildOption.hidden = false
      if (!elements.catalogView.hidden) showHome()
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

  async function install(event) {
    event.preventDefault()
    await installSpec(elements.spec.value, elements.allowBuild.checked)
  }

  async function installCatalogPlugin(plugin) {
    await installSpec(plugin.spec, false)
  }

  async function openSource(url) {
    const result = await api.openSource(url)
    if (!result?.ok) setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
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
  elements.discoverSearch.addEventListener('input', renderDiscovery)
  elements.openCatalog.addEventListener('click', showCatalog)
  elements.closeCatalog.addEventListener('click', showHome)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.catalogView.hidden && !busy) showHome()
  })
  elements.restart.addEventListener('click', restart)
  document.querySelector('#refresh').addEventListener('click', () => void load())
  document.querySelector('#docs').addEventListener('click', () => void api?.openDocs())
  void load()
})()
