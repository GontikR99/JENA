package staticfiles

import (
	"embed"
	"io/fs"
)

//go:embed all:app
var embeddedApp embed.FS

func App() fs.FS {
	app, err := fs.Sub(embeddedApp, "app")
	if err != nil {
		panic(err)
	}

	return app
}
