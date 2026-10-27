package sip

import (
	"encoding/json"
	"os"
	"testing"
)

// TestPhoneNumberVectors: the shared vectors of proto/testdata/phone_numbers.json (the client's
// lib/phoneNumber.ts runs the same).
func TestPhoneNumberVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../../proto/testdata/phone_numbers.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cases []struct {
			In       string `json:"in"`
			CallerID string `json:"callerId"`
			Number   string `json:"number"`
			Contact  string `json:"contact"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Cases) < 10 {
		t.Fatalf("only %d vectors", len(v.Cases))
	}
	for _, c := range v.Cases {
		if got, ok := NormalizeNumber(c.In); (ok && got != c.Number) || (!ok && c.Number != "") {
			t.Errorf("NormalizeNumber(%q) = %q %v, want %q", c.In, got, ok, c.Number)
		}
		if got, ok := NormalizeContactNumber(c.In, c.CallerID); (ok && got != c.Contact) || (!ok && c.Contact != "") {
			t.Errorf("NormalizeContactNumber(%q, %q) = %q %v, want %q", c.In, c.CallerID, got, ok, c.Contact)
		}
	}
}
