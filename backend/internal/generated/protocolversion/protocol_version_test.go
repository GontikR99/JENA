package protocolversion

import (
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestProtocolVersionMatchesRootFile(t *testing.T) {
	data, err := os.ReadFile("../../../../protocol-version.txt")
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}

	version, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatalf("protocol-version.txt is not an integer: %v", err)
	}
	if version <= 0 {
		t.Fatalf("protocol-version.txt version %d, want positive integer", version)
	}
	if ProtocolVersion != version {
		t.Fatalf("ProtocolVersion %d, want %d", ProtocolVersion, version)
	}
}
