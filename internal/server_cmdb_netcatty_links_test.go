package internal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"czfy-assets/internal/store"
)

func TestCmdbNetcattyLinkAPIRejectsSecretFields(t *testing.T) {
	s := newCmdbTestServer(t)
	scope, _ := s.Store.DefaultProjectScope()
	assetID, err := s.Store.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{Name: "API 主机关联"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	body := fmt.Sprintf(`{"asset_type":"infrastructure","asset_id":%d,"host_id":"host-1","host_name":"主机一","password":"不能进入 Cmdb"}`, assetID)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/cmdb/netcatty-links", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("秘密字段应被拒绝，状态码=%d 响应=%s", rec.Code, rec.Body.String())
	}
}

func TestCmdbNetcattyHostUsageOnlyReturnsOtherReferenceCount(t *testing.T) {
	s := newCmdbTestServer(t)
	first, _ := s.Store.DefaultProjectScope()
	secondProject, err := s.Store.CreateCmdbProject(&store.CmdbProject{Code: "OTHER", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	firstID, err := s.Store.CreateCmdbAssetManualForProject(first, &store.CmdbAsset{Name: "当前设备"})
	if err != nil {
		t.Fatal(err)
	}
	secondScope := store.ProjectScope{ProjectID: secondProject.ID}
	secondID, err := s.Store.CreateCmdbAssetManualForProject(secondScope, &store.CmdbAsset{Name: "不应泄露的设备"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		scope   store.ProjectScope
		assetID int64
	}{{first, firstID}, {secondScope, secondID}} {
		if _, err := s.Store.SaveCmdbNetcattyLinkForProject(item.scope, &store.CmdbNetcattyLink{AssetType: "infrastructure", AssetID: item.assetID, HostID: "shared-host", IsPrimary: true}); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	path := fmt.Sprintf("/api/cmdb/netcatty-links/host-usage?host_id=shared-host&asset_type=infrastructure&asset_id=%d", firstID)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("状态码=%d 响应=%s", rec.Code, rec.Body.String())
	}
	var result map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result["other_references"] != float64(1) || strings.Contains(rec.Body.String(), "不应泄露") {
		t.Fatalf("只应返回计数: %s", rec.Body.String())
	}
}
