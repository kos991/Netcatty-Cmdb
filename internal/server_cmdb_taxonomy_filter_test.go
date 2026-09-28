package internal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"czfy-assets/internal/store"
)

func TestTerminalAssetsFilterByClassificationAndAssetGroup(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	groupA, err := st.CreateCmdbTaxonomy("groups", "办公区", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := st.CreateCmdbTaxonomy("groups", "机房区", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, asset := range []store.Asset{
		{AssetCode: "PC-FILTER", DeviceType: "台式电脑", GroupID: groupA, Status: "在用"},
		{AssetCode: "NB-FILTER", DeviceType: "笔记本", GroupID: groupB, Status: "在用"},
	} {
		if _, err := st.CreateAsset(&asset, "测试"); err != nil {
			t.Fatal(err)
		}
	}

	target := fmt.Sprintf("/api/assets?device_type=%s&group_id=%d&page=1&page_size=20", url.QueryEscape("台式电脑"), groupA)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("筛选终端资产失败: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		List  []store.Asset `json:"list"`
		Total int           `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Total != 1 || len(response.List) != 1 || response.List[0].AssetCode != "PC-FILTER" || response.List[0].GroupName != "办公区" {
		t.Fatalf("终端分类与分组筛选未生效: %+v", response)
	}
}

func TestApplicationsFilterByClassificationAndAssetGroup(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	groupA, err := st.CreateCmdbTaxonomy("groups", "生产系统", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := st.CreateCmdbTaxonomy("groups", "测试系统", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, app := range []store.ServerApp{
		{AppName: "审判系统", AppType: "业务应用", GroupID: groupA, Status: "正常运行"},
		{AppName: "测试门户", AppType: "业务应用", GroupID: groupB, Status: "正常运行"},
	} {
		if _, err := st.CreateApp(&app); err != nil {
			t.Fatal(err)
		}
	}

	target := fmt.Sprintf("/api/apps?app_type=%s&group_id=%d&page=1&page_size=20", url.QueryEscape("业务应用"), groupA)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("筛选业务系统失败: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		List  []store.ServerApp `json:"list"`
		Total int               `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Total != 1 || len(response.List) != 1 || response.List[0].AppName != "审判系统" || response.List[0].GroupName != "生产系统" {
		t.Fatalf("业务系统分类与分组筛选未生效: %+v", response)
	}
}
