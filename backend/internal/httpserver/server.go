package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"

	"jena/backend/internal/config"
)

type Server struct {
	config config.Config
	mux    *http.ServeMux
	server *http.Server
}

func New(config config.Config) *Server {
	mux := http.NewServeMux()

	return &Server{
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
	server.Register("/", StaticAppHandler(server.config.StaticDir))
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

func StaticAppHandler(staticDir string) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		indexPath := filepath.Join(staticDir, "index.html")
		requestPath := path.Clean("/" + request.URL.Path)
		relativePath := filepath.FromSlash(requestPath[1:])
		filePath := filepath.Join(staticDir, relativePath)

		if relativePath == "" {
			filePath = indexPath
		}

		fileInfo, err := os.Stat(filePath)
		if err == nil && !fileInfo.IsDir() {
			http.ServeFile(response, request, filePath)
			return
		}

		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(response, request, indexPath)
			return
		}

		http.Error(
			response,
			fmt.Sprintf("frontend assets were not found in %q", staticDir),
			http.StatusNotFound,
		)
	})
}
