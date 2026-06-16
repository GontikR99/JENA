package httpserver

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestStaticAppHandlerServesIndexForUnknownRoute(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/triggers", nil)
	response := httptest.NewRecorder()

	StaticAppHandler(testStaticFS()).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.String() != "app" {
		t.Fatalf("body %q, want app", response.Body.String())
	}
}

func TestStaticAppHandlerServesAsset(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/assets/main.js", nil)
	response := httptest.NewRecorder()

	StaticAppHandler(testStaticFS()).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.String() != "js" {
		t.Fatalf("body %q, want js", response.Body.String())
	}
}

func testStaticFS() fs.FS {
	return fstest.MapFS{
		"assets/main.js": {
			Data: []byte("js"),
		},
		"index.html": {
			Data: []byte("app"),
		},
	}
}
