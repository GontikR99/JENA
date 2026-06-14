package app

import (
	"fmt"
	"reflect"
)

type Container struct {
	values map[reflect.Type]any
}

func NewContainer() *Container {
	return &Container{
		values: make(map[reflect.Type]any),
	}
}

func Install[T any](container *Container, value T) {
	container.values[reflect.TypeFor[T]()] = value
}

func Get[T any](container *Container) (T, error) {
	value, ok := container.values[reflect.TypeFor[T]()]
	if !ok {
		var zero T
		return zero, fmt.Errorf("dependency %s is not installed", reflect.TypeFor[T]())
	}

	typedValue, ok := value.(T)
	if !ok {
		var zero T
		return zero, fmt.Errorf("dependency %s has unexpected type", reflect.TypeFor[T]())
	}

	return typedValue, nil
}
