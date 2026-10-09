package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
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

func TestTerminalAssetActualFiltersMatchAcrossListAndExport(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	for _, asset := range []store.Asset{
		{
			AssetName: "执行局终端 A", AssetCode: "TERMINAL-MATCH", DeviceType: "台式电脑",
			UserName: "张三", Department: "执行局", Room: "502室", IP: "10.20.40.10",
			NetType: "", OSType: "统信 UOS", Status: "在用",
		},
		{
			AssetName: "执行局终端 B", AssetCode: "TERMINAL-OTHER", DeviceType: "台式电脑",
			UserName: "李四", Department: "执行局", Room: "502室", IP: "10.20.40.11",
			NetType: "", OSType: "统信 UOS", Status: "在用",
		},
	} {
		if _, err := st.CreateAsset(&asset, "测试"); err != nil {
			t.Fatal(err)
		}
	}
	query := "/api/assets?keyword=" + url.QueryEscape("执行局终端") + "&device_type=" + url.QueryEscape("台式电脑") +
		"&user_name=" + url.QueryEscape("张三") + "&dept=" + url.QueryEscape("执行局") +
		"&room=" + url.QueryEscape("502室") + "&net_type=" + url.QueryEscape(store.AssetUnconfiguredFilter) +
		"&os_type=" + url.QueryEscape("统信 UOS") + "&status=" + url.QueryEscape("在用") + "&group_id=-1&page=1&page_size=20"
	listResponse := httptest.NewRecorder()
	mux.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, query, nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("终端筛选查询失败: status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var response struct {
		List  []store.Asset `json:"list"`
		Total int           `json:"total"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Total != 1 || len(response.List) != 1 || response.List[0].AssetCode != "TERMINAL-MATCH" {
		t.Fatalf("列表筛选条件未按交集执行: %+v", response)
	}

	exportQuery := strings.Replace(query, "/api/assets?", "/api/export/assets?", 1)
	exportResponse := httptest.NewRecorder()
	mux.ServeHTTP(exportResponse, httptest.NewRequest(http.MethodGet, exportQuery, nil))
	if exportResponse.Code != http.StatusOK {
		t.Fatalf("终端筛选导出失败: status=%d body=%s", exportResponse.Code, exportResponse.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(exportResponse.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	rows, err := book.GetRows("资产台账")
	if err != nil || len(rows) != 2 || rows[1][1] != "执行局终端 A" || rows[1][2] != "TERMINAL-MATCH" {
		t.Fatalf("导出未复用列表筛选或名称/编码列错位: rows=%v err=%v", rows, err)
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

func TestApplicationsFilterByActualFieldsAndReturnBusinessNetwork(t *testing.T) {
	_, st, mux := newLegacyHandlerTestServer(t)
	scope, _ := st.DefaultProjectScope()
	if _, err := st.CreateIPSubnetForProject(scope, &store.IPSubnet{Name: "应用专网", Category: "专网", CIDR: "10.122.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	hostID, err := st.CreateCmdbAssetManualForProject(scope, &store.CmdbAsset{Name: "生产服务器", DeviceType: "server", BizIP: "10.122.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAppForProject(scope, &store.ServerApp{AppName: "目标业务", AppType: "业务应用", Provider: "甲供应商", Owner: "张三", CmdbAssetID: hostID, ServiceIP: "10.122.0.10", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateAppForProject(scope, &store.ServerApp{AppName: "未承载业务", AppType: "业务应用", Provider: "甲供应商", Owner: "张三", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}

	params := url.Values{
		"provider": {"甲供应商"}, "owner": {"张三"}, "host_id": {fmt.Sprint(hostID)},
		"host_linked": {"linked"}, "network_type": {"专网"}, "group_id": {"-1"},
		"page": {"1"}, "page_size": {"20"},
	}
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/apps?"+params.Encode(), nil))
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
	if response.Total != 1 || len(response.List) != 1 || response.List[0].AppName != "目标业务" || response.List[0].NetworkType != "专网" || response.List[0].ServiceIP != "10.122.0.10" {
		t.Fatalf("业务系统实际字段筛选或网络标识错误: %+v", response)
	}
}
