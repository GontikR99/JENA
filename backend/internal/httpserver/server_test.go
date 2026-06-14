package httpserver

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticAppHandlerServesIndexForUnknownRoute(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("app"), 0o600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/triggers", nil)
	response := httptest.NewRecorder()

	StaticAppHandler(staticDir).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.String() != "app" {
		t.Fatalf("body %q, want app", response.Body.String())
	}
}

func TestStaticAppHandlerServesAsset(t *testing.T) {
	staticDir := t.TempDir()
	assetDir := filepath.Join(staticDir, "assets")
	if err := os.Mkdir(assetDir, 0o700); err != nil {
		t.Fatalf("Mkdir returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("app"), 0o600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "main.js"), []byte("js"), 0o600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/assets/main.js", nil)
	response := httptest.NewRecorder()

	StaticAppHandler(staticDir).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.String() != "js" {
		t.Fatalf("body %q, want js", response.Body.String())
	}
}
