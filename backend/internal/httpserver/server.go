package httpserver

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"jena/backend/internal/config"
	"jena/backend/internal/staticfiles"
)

type Server struct {
	appFS  fs.FS
	config config.Config
	mux    *http.ServeMux
	server *http.Server
}

func New(config config.Config) *Server {
	mux := http.NewServeMux()

	return &Server{
		appFS:  staticfiles.App(),
		config: config,
		mux:    mux,
		server: &http.Server{
			Addr:    config.Addr,
			Handler: mux,
		},
	}
}

func (server *Server) Register(pattern string, handler http.Handler) {
	server.mux.Handle(pattern, handler)
}

func (server *Server) RegisterFunc(pattern string, handler http.HandlerFunc) {
	server.mux.HandleFunc(pattern, handler)
}

func (server *Server) RegisterStaticApp() {
	server.Register("/", StaticAppHandler(server.appFS))
}

func (server *Server) Run(ctx context.Context) error {
	errs := make(chan error, 1)

	go func() {
		slog.Info("starting backend HTTP server", "addr", server.config.Addr)
		errs <- server.server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := server.server.Shutdown(shutdownCtx); err != nil {
			return err
		}

		return ctx.Err()
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}

		return err
	}
}

func StaticAppHandler(appFS fs.FS) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		requestPath := path.Clean("/" + request.URL.Path)
		relativePath := strings.TrimPrefix(requestPath, "/")

		fileInfo, err := fs.Stat(appFS, relativePath)
		if err == nil && !fileInfo.IsDir() {
			serveEmbeddedPath(appFS, response, request, relativePath, fileInfo)
			return
		}

		indexInfo, err := fs.Stat(appFS, "index.html")
		if err == nil {
			serveEmbeddedPath(appFS, response, request, "index.html", indexInfo)
			return
		}

		http.Error(
			response,
			"frontend assets were not embedded",
			http.StatusNotFound,
		)
	})
}

func serveEmbeddedPath(
	appFS fs.FS,
	response http.ResponseWriter,
	request *http.Request,
	filePath string,
	fileInfo fs.FileInfo,
) {
	data, err := fs.ReadFile(appFS, filePath)
	if err != nil {
		http.NotFound(response, request)
		return
	}

	http.ServeContent(
		response,
		request,
		path.Base(filePath),
		fileInfo.ModTime(),
		bytes.NewReader(data),
	)
}
