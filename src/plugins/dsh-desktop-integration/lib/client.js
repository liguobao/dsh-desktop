window.__ModuleLoader__.load({
  id: '@dsh-desktop/integration',
  factory: () => {
    const module = { exports: {} }
    const bridge = globalThis.dshDesktop

    const inject = ['sessions', 'workspaces']

    function apply(ctx) {
      if (bridge === undefined
        || typeof bridge.openPath !== 'function'
        || typeof bridge.publishWorkspaceContext !== 'function') return

      ctx.effect(() => {
        const workspaces = ctx.workspaces
        const sessions = ctx.sessions
        const originalOpenPath = workspaces.openPath
        const hadOwnOpenPath = Object.hasOwn(workspaces, 'openPath')

        const openPath = async (path) => {
          let result
          try {
            result = await bridge.openPath(path)
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
