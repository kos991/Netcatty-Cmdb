package internal

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal/store"
)

func newCmdbTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "server_cmdb_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := st.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("映射同步失败: %v", err)
	}
	return &Server{Store: st}
}

func TestHandleCmdbAssetsReturnsPagedList(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets?page=1&page_size=5", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("状态码应为 200，实际 %d，响应 %s", rec.Code, rec.Body.String())
	}
	var body struct {
		List     []store.CmdbAsset `json:"list"`
		Total    int               `json:"total"`
		Page     int               `json:"page"`
		PageSize int               `json:"page_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应不是合法 JSON: %v", err)
	}
	if body.Page != 1 || body.PageSize != 5 {
		t.Fatalf("分页回显错误: %+v", body)
	}
}

func TestHandleCmdbAssetNotFoundReturnsExplicitError(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets/999999", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("不存在资产应返回 404，实际 %d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] == "" {
		t.Fatalf("404 必须带明确 error 说明，实际响应 %s", rec.Body.String())
	}
}

func TestHandleCmdbAssetInvalidLegacyAddressReturnsInterfaceError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid-interface-api.db")
	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	id, err := st.CreateCmdbAssetManual(&store.CmdbAsset{Name: "旧设备", Interfaces: []store.CmdbAssetInterface{{Name: "eth0", IP: "192.0.2.10"}}})
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`UPDATE cmdb_asset_interfaces SET additional_ips_json='{bad' WHERE asset_id=?`, id); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&Server{Store: st}).RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/assets/%d", id), nil))
	if rec.Code != http.StatusInternalServerError || !bytes.Contains(rec.Body.Bytes(), []byte("接口 eth0")) || !bytes.Contains(rec.Body.Bytes(), []byte("附加地址格式无效")) {
		t.Fatalf("详情应返回可见的接口错误: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleReplaceCmdbAssetPersistsCompleteProfile(t *testing.T) {
	s := newCmdbTestServer(t)
	id, err := s.Store.CreateCmdbAssetManual(&store.CmdbAsset{Name: "待完善设备", Status: "在库"})
	if err != nil {
		t.Fatal(err)
	}
	payload := store.CmdbAsset{
		Name: "核心交换机", Status: "在线", AssetClass: "physical", DeviceType: "switch",
		Province: "江苏省", City: "常州市", Address: "机房 A", PortCount: 48,
		RatedPowerW: 300, OSType: "网络设备系统", OSVersion: "1.0",
		Interfaces: []store.CmdbAssetInterface{{Name: "mgmt0", IP: "10.20.30.40", Mask: "24", NetworkZone: "管理网", IsPrimary: 1}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/cmdb/assets/%d/full", id), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("完整资产保存失败: status=%d body=%s", rec.Code, rec.Body.String())
	}
	asset, interfaces, err := s.Store.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Name != payload.Name || asset.City != payload.City || asset.PortCount != 48 || asset.OSVersion != "1.0" {
		t.Fatalf("完整字段未保存: %+v", asset)
	}
	if len(interfaces) != 1 || interfaces[0].IP != "10.20.30.40" || interfaces[0].IsPrimary != 1 {
		t.Fatalf("网络接口未保存: %+v", interfaces)
	}
}

func TestHandleCmdbAssetDetailAggregatesIPAMAndLinks(t *testing.T) {
	s := newCmdbTestServer(t)
	coreID, err := s.Store.CreateCmdbAssetManual(&store.CmdbAsset{
		Name: "核心交换机 A", AssetCode: "NET-SW-001", Status: "在线", DeviceType: "switch",
		MgmtIP: "10.20.30.2", Interfaces: []store.CmdbAssetInterface{{Name: "mgmt0", IP: "10.20.30.2", IsPrimary: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := s.Store.CreateCmdbAssetManual(&store.CmdbAsset{
		Name: "虚拟化节点 01", AssetCode: "SRV-001", Status: "在线", DeviceType: "server",
		Interfaces: []store.CmdbAssetInterface{{Name: "eth0", IP: "10.20.30.10", IsPrimary: 1}},
	})
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	subnetBody := `{"name":"服务器业务网","category":"内网","prefix":"10.20.30","cidr":"10.20.30.0/24","gateway":"10.20.30.1","vlan":"230","vni":"10230","purpose":"生产业务"}`
	subnetReq := httptest.NewRequest(http.MethodPost, "/api/ip_subnets", bytes.NewBufferString(subnetBody))
	subnetReq.Header.Set("Content-Type", "application/json")
	subnetRec := httptest.NewRecorder()
	mux.ServeHTTP(subnetRec, subnetReq)
	if subnetRec.Code != http.StatusOK {
		t.Fatalf("创建网段失败: status=%d body=%s", subnetRec.Code, subnetRec.Body.String())
	}
	if rows, total, err := s.Store.QueryIPEntries(store.IPEntryQuery{Keyword: "10.20.30.2", Page: 1, PageSize: 20}); err != nil || total != 1 || rows[0].OwnerType != "infrastructure" || rows[0].OwnerID != coreID {
		t.Fatalf("创建网段后应自动纳入交换机管理 IP：rows=%+v total=%d err=%v", rows, total, err)
	}

	linkBody := fmt.Sprintf(`{"local_interface_id":0,"local_port":"Gi1/0/12","direction":"downlink","peer_asset_id":%d,"peer_port":"eth0","vlan":"230","vni":"10230","status":"在线"}`, serverID)
	linkReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/cmdb/assets/%d/links", coreID), bytes.NewBufferString(linkBody))
	linkReq.Header.Set("Content-Type", "application/json")
	linkRec := httptest.NewRecorder()
	mux.ServeHTTP(linkRec, linkReq)
	if linkRec.Code != http.StatusCreated {
		t.Fatalf("新增资产链路失败: status=%d body=%s", linkRec.Code, linkRec.Body.String())
	}

	detailReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cmdb/assets/%d", coreID), nil)
	detailRec := httptest.NewRecorder()
	mux.ServeHTTP(detailRec, detailReq)
	if detailRec.Code != http.StatusOK {
		t.Fatalf("读取资产详情失败: status=%d body=%s", detailRec.Code, detailRec.Body.String())
	}
	var detail struct {
		IPAM []struct {
			IP      string `json:"ip"`
			Subnet  string `json:"subnet"`
			CIDR    string `json:"cidr"`
			VLAN    string `json:"vlan"`
			VNI     string `json:"vni"`
			Purpose string `json:"purpose"`
		} `json:"ipam"`
		Links []struct {
			Direction     string `json:"direction"`
			PeerAssetID   int64  `json:"peer_asset_id"`
			PeerAssetName string `json:"peer_asset_name"`
			PeerPort      string `json:"peer_port"`
		} `json:"links"`
		DownstreamAssets []store.CmdbAsset `json:"downstream_assets"`
		History          []interface{}     `json:"history"`
	}
	if err := json.Unmarshal(detailRec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if len(detail.IPAM) != 1 || detail.IPAM[0].Subnet != "服务器业务网" || detail.IPAM[0].CIDR != "10.20.30.0/24" || detail.IPAM[0].VLAN != "230" || detail.IPAM[0].VNI != "10230" || detail.IPAM[0].Purpose != "生产业务" {
		t.Fatalf("IPAM 聚合不完整: %+v", detail.IPAM)
	}
	if len(detail.Links) != 1 || detail.Links[0].Direction != "downlink" || detail.Links[0].PeerAssetID != serverID || detail.Links[0].PeerAssetName != "虚拟化节点 01" || detail.Links[0].PeerPort != "eth0" {
		t.Fatalf("链路聚合不完整: %+v", detail.Links)
	}
	if len(detail.DownstreamAssets) != 1 || detail.DownstreamAssets[0].ID != serverID {
		t.Fatalf("下联设备聚合不完整: %+v", detail.DownstreamAssets)
	}
	if detail.History == nil {
		t.Fatal("变更履历必须返回数组，不能返回 null")
	}
}
