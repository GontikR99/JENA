export type Deps = Map<ComponentClass, unknown>

export type ComponentClass<TInstance = unknown> = {
  new (deps: Deps): TInstance
}

export function createDeps(): Deps {
  return new Map()
}

export function install<TInstance>(
  deps: Deps,
  ComponentClass: ComponentClass<TInstance>,
) {
  const instance = new ComponentClass(deps)

  deps.set(ComponentClass, instance)

  return instance
}

export function installInstance<TInstance>(
  deps: Deps,
  ComponentClass: ComponentClass<TInstance>,
  instance: TInstance,
) {
  deps.set(ComponentClass, instance)

  return instance
}

export function getDependency<TInstance>(
  deps: Deps,
  ComponentClass: ComponentClass<TInstance>,
) {
  const instance = deps.get(ComponentClass)

  if (!instance) {
    throw new Error(`${ComponentClass.name} has not been installed.`)
  }

  return instance as TInstance
}
