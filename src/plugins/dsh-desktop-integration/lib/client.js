window.__ModuleLoader__.load({
  id: '@dsh-desktop/integration',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const bridge = globalThis.dshDesktop

    const NS = 'dsh-desktop'
    const STYLE_ID = '@dsh-desktop/integration/actions'
    const WORKSPACE_ACTIONS_MARKER = 'dshDesktopWorkspaceActions'
    const inject = ['sessions', 'workspaces', 'slots', 'locale']
    const dictionaries = {
      zh: {
        'open.editor': '用编辑器打开',
        'open.fileManager': '打开文件夹',
        'open.workspaceEditor.aria': '使用首选编辑器打开此工作区',
      },
      en: {
        'open.editor': 'Open in Editor',
        'open.fileManager': 'Open Folder',
        'open.workspaceEditor.aria': 'Open this workspace in the preferred editor',
      },
    }

    function CodeIcon({ size = 16 } = {}) {
      return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M13.25 1.2 7 7.05 3.5 4.35 1.5 6.15 4.25 8 1.5 9.85l2 1.8L7 8.95l6.25 5.85 1.25-.6V1.8l-1.25-.6Zm0 3v7.6L8.9 8l4.35-3.8Z',
        fill: 'currentColor',
        fillRule: 'evenodd',
      }))
    }

    function iconElement(kind) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('fill', 'currentColor')
      if (kind === 'editor') {
        path.setAttribute('fill-rule', 'evenodd')
        path.setAttribute('d', 'M13.25 1.2 7 7.05 3.5 4.35 1.5 6.15 4.25 8 1.5 9.85l2 1.8L7 8.95l6.25 5.85 1.25-.6V1.8l-1.25-.6Zm0 3v7.6L8.9 8l4.35-3.8Z')
      } else {
        path.setAttribute('d', 'M2.42 2.25h3.03c.45 0 .87.22 1.12.6l.48.72h6.53c.83 0 1.5.67 1.5 1.5v6.93c0 .97-.78 1.75-1.75 1.75H2.42A1.5 1.5 0 0 1 .92 12V3.75c0-.83.67-1.5 1.5-1.5Zm0 1.3a.2.2 0 0 0-.2.2V12c0 .25.2.45.45.45h10.66c.25 0 .45-.2.45-.45V5.07a.2.2 0 0 0-.2-.2H6.35L5.5 3.6a.12.12 0 0 0-.1-.05H2.42Z')
      }
      svg.append(path)
      return svg
    }

    async function requestNativeOpen(path, intent) {
      const result = await bridge.openPath(path, intent)
      if (result?.ok !== true) throw new Error(result?.error ?? 'Desktop path open failed')
    }

    function WorkspaceEditorAction({ sessionId, openWorkspace, t }) {
      const [busy, setBusy] = React.useState(false)
      const label = t('open.workspaceEditor.aria')
      const open = async () => {
        setBusy(true)
        try {
          await openWorkspace(sessionId)
        } catch (error) {
          console.warn('DSH Desktop could not open the workspace in an editor.', error)
        } finally {
          setBusy(false)
        }
      }
      return React.createElement('button', {
        type: 'button',
        className: 'dshDesktopEditorButton',
        disabled: busy,
        'aria-busy': busy,
        'aria-label': label,
        title: label,
        onClick: open,
      }, React.createElement(CodeIcon))
    }

    function installStyle() {
      if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = '@dsh-desktop/integration'
      style.dataset.pluginCss = STYLE_ID
      style.textContent = [
        '.dshDesktopEditorButton{box-sizing:border-box;width:32px;height:32px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex}',
        '.dshDesktopEditorButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dshDesktopEditorButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
        '.dshDesktopEditorButton:disabled{color:var(--dsw-alias-label-dimmed);cursor:wait}',
        '.dshDesktopWorkspaceSeparator{height:1px;background:var(--dsw-alias-border-l3);margin:4px 8px}',
      ].join('')
      document.head.append(style)
      return () => style.remove()
    }

    function workspaceRows() {
      return Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded]'))
        .filter(row => row.querySelectorAll('button').length >= 2)
    }

    function createMenuAction(template, label, kind, path, intent) {
      const wrapper = template.cloneNode(true)
      wrapper.dataset.dshDesktopAction = kind
      const button = wrapper.querySelector('button[role="menuitem"]')
      if (button === null) return undefined
      button.removeAttribute('disabled')
      button.removeAttribute('aria-expanded')
      button.removeAttribute('aria-haspopup')
      const spans = button.querySelectorAll('span')
      if (spans.length < 2) return undefined
      spans[0].replaceChildren(iconElement(kind))
      spans[1].textContent = label
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        void requestNativeOpen(path, intent).catch((error) => {
          console.warn(`DSH Desktop could not open the workspace with intent ${intent}.`, error)
        })
      })
      return wrapper
    }

    function installWorkspaceMenuActions(workspaces, t) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      let pendingPath
      let pendingAt = 0
      let pendingTimer

      const injectActions = (menu) => {
        if (pendingPath === undefined || performance.now() - pendingAt > 1500) return false
        if (!(menu instanceof HTMLElement) || menu.dataset[WORKSPACE_ACTIONS_MARKER] === 'true') return false
        const viewport = Array.from(menu.children).find(child => child.getAttribute('role') === 'presentation')
        if (!(viewport instanceof HTMLElement)) return false
        const menuItems = Array.from(viewport.children)
          .map(child => child.querySelector(':scope > button[role="menuitem"]'))
          .filter(button => button !== null)
        const labels = menuItems.map(button => button.textContent?.trim())
        const isWorkspaceMenu = menuItems.length === 2
          && ['Rename', '重命名'].includes(labels[0])
          && ['Delete workspace', '删除工作区'].includes(labels[1])
        if (!isWorkspaceMenu) return false
        const template = menuItems[0].parentElement
        if (!(template instanceof HTMLElement)) return false

        const editor = createMenuAction(template, t('open.editor'), 'editor', pendingPath, 'editor')
        const fileManager = createMenuAction(template, t('open.fileManager'), 'fileManager', pendingPath, 'default')
        if (editor === undefined || fileManager === undefined) return false
        const separator = document.createElement('div')
        separator.className = 'dshDesktopWorkspaceSeparator'
        separator.setAttribute('role', 'separator')
        const fragment = document.createDocumentFragment()
        fragment.append(editor, fileManager, separator)
        viewport.prepend(fragment)
        menu.dataset[WORKSPACE_ACTIONS_MARKER] = 'true'
        pendingPath = undefined
        clearTimeout(pendingTimer)
        return true
      }

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue
            if (node.getAttribute('role') === 'menu' && injectActions(node)) return
            for (const menu of node.querySelectorAll('[role="menu"]')) {
              if (injectActions(menu)) return
            }
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })

      const captureWorkspaceMenu = (event) => {
        if (!(event.target instanceof Element)) return
        const button = event.target.closest('button')
        const row = button?.closest('[role="treeitem"][aria-expanded]')
        if (button === null || row === null) return
        const buttons = Array.from(row.querySelectorAll('button'))
        if (buttons.length < 2 || buttons[0] !== button) return
        const rows = workspaceRows()
        const index = rows.indexOf(row)
        const workspace = index < 0 ? undefined : workspaces.list.getSnapshot().items[index]
        if (typeof workspace?.path !== 'string') return
        pendingPath = workspace.path
        pendingAt = performance.now()
        clearTimeout(pendingTimer)
        pendingTimer = setTimeout(() => {
          pendingPath = undefined
        }, 1500)
      }
      document.addEventListener('click', captureWorkspaceMenu, true)

      return () => {
        clearTimeout(pendingTimer)
        observer.disconnect()
        document.removeEventListener('click', captureWorkspaceMenu, true)
      }
    }

    function apply(ctx) {
      if (bridge === undefined
        || typeof bridge.openPath !== 'function'
        || typeof bridge.publishWorkspaceContext !== 'function') return

      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-desktop: browser dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(installStyle, 'dsh-desktop: native action styles')

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-desktop-workspace-editor',
        order: -10,
        locale: NS,
        inject: () => ({
          openWorkspace: (sessionId) => {
            const path = ctx.sessions.list.getSnapshot().byId[String(sessionId)]?.cwd
            if (typeof path !== 'string') throw new Error('Session workspace is unavailable')
            return requestNativeOpen(path, 'editor')
          },
        }),
      }, WorkspaceEditorAction))

      // Harness exposes a slot for the header utility, but not for children of
      // the Workspace ellipsis menu. Keep this adapter scoped to that portal.
      ctx.effect(() => installWorkspaceMenuActions(ctx.workspaces, t), 'dsh-desktop: workspace menu actions')

      ctx.effect(() => {
        const workspaces = ctx.workspaces
        const sessions = ctx.sessions
        const originalOpenPath = workspaces.openPath
        const hadOwnOpenPath = Object.hasOwn(workspaces, 'openPath')

        const openPath = async (path) => {
          let result
          try {
            result = await bridge.openPath(path, 'auto')
          } catch (error) {
            console.warn('DSH Desktop path bridge failed; falling back to the Harness opener.', error)
            return originalOpenPath.call(workspaces, path)
          }
          if (result?.ok !== true) throw new Error(result?.error ?? 'Desktop path open failed')
        }

        const publish = () => {
          const sessionState = sessions.list.getSnapshot()
          const workspaceState = workspaces.list.getSnapshot()
          const currentPath = sessionState.current === undefined
            ? undefined
            : sessionState.byId[sessionState.current]?.cwd
          const recentPath = workspaceState.recentWorkspaceId === undefined
            ? undefined
            : workspaceState.items.find(workspace => workspace.workspaceId === workspaceState.recentWorkspaceId)?.path
          const active = currentPath ?? recentPath
          bridge.publishWorkspaceContext({
            active,
            roots: workspaceState.items.map(workspace => workspace.path),
          })
        }

        workspaces.openPath = openPath
        const unsubscribeSessions = sessions.list.subscribe(publish)
        const unsubscribeWorkspaces = workspaces.list.subscribe(publish)
        publish()

        return () => {
          unsubscribeSessions()
          unsubscribeWorkspaces()
          if (workspaces.openPath === openPath) {
            if (hadOwnOpenPath) workspaces.openPath = originalOpenPath
            else delete workspaces.openPath
          }
        }
      }, 'dsh-desktop: native path adapter')
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
