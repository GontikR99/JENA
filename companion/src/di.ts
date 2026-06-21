export type Constructor<T> = abstract new (...args: never[]) => T

export class Container {
  private readonly instances = new Map<unknown, unknown>()

  get<T>(key: Constructor<T>): T {
    const instance = this.instances.get(key)
    if (!instance) {
      throw new Error(`Dependency ${key.name} is not installed.`)
    }

    return instance as T
  }

  install<T>(key: Constructor<T>, value: T) {
    this.instances.set(key, value)
  }
}

export interface Disposable {
  dispose(): void
}
