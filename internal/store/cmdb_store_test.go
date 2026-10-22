package store

import (
	"path/filepath"
	"testing"
)

func newCmdbTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_store_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func insertCmdbAsset(t *testing.T, s *Store, a CmdbAsset) int64 {
	t.Helper()
	id, err := s.InsertCmdbAsset(&a)
	if err != nil {
		t.Fatalf("插入测试资产失败: %v", err)
	}
	return id
}

func TestQueryCmdbAssetsFiltersAndPaginates(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U交换机-5141", AssetCode: "ZC202508140001", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "2U交换机-8037", AssetCode: "ZC202508140002", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U配线架-7467", AssetCode: "ZC202508140003", Status: "在库", CategoryID: 2})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 3 {
		t.Fatalf("总数应为 3，实际 %d", total)
	}
	if len(list) != 2 {
		t.Fatalf("第一页应返回 2 条，实际 %d", len(list))
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{Keyword: "配线架", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("关键词查询失败: %v", err)
	}
	if total != 1 || list[0].Name != "1U配线架-7467" {
		t.Fatalf("关键词过滤结果错误: total=%d list=%+v", total, list)
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{CategoryID: 1, Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("分类过滤失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("分类过滤应返回 2 条，实际 %d", total)
	}

	list, _, err = s.QueryCmdbAssets(CmdbAssetQuery{Status: "在库", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("状态过滤失败: %v", err)
	}
	if len(list) != 1 || list[0].Status != "在库" {
		t.Fatalf("状态过滤结果错误: %+v", list)
	}
}

func TestAttachCmdbAssetBusinessNetworkTypesUsesBusinessIPAMSubnet(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	assetID := insertCmdbAsset(t, s, CmdbAsset{Name: "业务服务器", AssetCode: "INFRA-001", BizIP: "192.0.2.20", MgmtIP: "10.0.0.20", NetType: "外网"})
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "政法专网", Category: "专网", CIDR: "192.0.2.0/24"}); err != nil {
		t.Fatal(err)
	}
	list, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachCmdbAssetBusinessNetworkTypesForProject(scope, list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != assetID || list[0].BusinessNetworkType != "专网" {
		t.Fatalf("业务 IP 网络归属错误: %+v", list)
	}
}

func TestAttachCmdbAssetBusinessNetworkTypesDoesNotUseManagementIPAMSubnet(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	assetID := insertCmdbAsset(t, s, CmdbAsset{Name: "管理服务器", AssetCode: "INFRA-MGMT", MgmtIP: "10.20.30.5"})
	if _, err := s.CreateIPSubnetForProject(scope, &IPSubnet{Name: "内网", Category: "内网", CIDR: "10.20.30.0/24"}); err != nil {
		t.Fatal(err)
	}
	list, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachCmdbAssetBusinessNetworkTypesForProject(scope, list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != assetID || list[0].BusinessNetworkType != "" {
		t.Fatalf("仅管理 IP 不应提供业务网络归属: %+v", list)
	}
}

func TestAttachCmdbAssetBusinessNetworkTypesMatchesUnregisteredIPBySubnetCIDR(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	// 网段先于资产建立：资产 IP 未登记进 IP 台账，只能按网段 CIDR 判定。
	for _, subnet := range []IPSubnet{
		{Name: "管理网", Category: "内网", CIDR: "10.9.9.0/24"},
		{Name: "大段", Category: "外网", CIDR: "172.16.0.0/16"},
		{Name: "小段", Category: "专网", CIDR: "172.16.5.0/24"},
	} {
		subnet := subnet
		if _, err := s.CreateIPSubnetForProject(scope, &subnet); err != nil {
			t.Fatal(err)
		}
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "双网服务器", AssetCode: "INFRA-DUAL", BizIP: "172.16.5.9", MgmtIP: "10.9.9.9"})
	list, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachCmdbAssetBusinessNetworkTypesForProject(scope, list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BusinessNetworkType != "专网" {
		t.Fatalf("业务 IP 应优先并取最长前缀网段: %+v", list)
	}
}

func TestBusinessNetworkSourcesStayConsistentForListFilterAndExport(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	for _, subnet := range []IPSubnet{
		{Name: "管理", Category: "外网", CIDR: "10.42.0.0/24"},
		{Name: "业务大段", Category: "内网", CIDR: "172.24.0.0/16"},
		{Name: "业务小段", Category: "专网", CIDR: "172.24.8.0/24"},
	} {
		subnet := subnet
		if _, err := s.CreateIPSubnetForProject(scope, &subnet); err != nil {
			t.Fatal(err)
		}
	}
	for _, asset := range []CmdbAsset{
		{Name: "业务管理分离", BizIP: "172.24.8.10", MgmtIP: "10.42.0.10", NetType: "外网"},
		{Name: "仅管理", MgmtIP: "10.42.0.11", NetType: "外网"},
		{Name: "接口业务", MgmtIP: "10.42.0.12", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "172.24.8.12", AdditionalIPsJSON: `[{"ip":"172.24.8.12","purpose":"business"},{"ip":"10.42.0.12","purpose":"management"}]`}}},
		{Name: "附加业务", Interfaces: []CmdbAssetInterface{{Name: "eth1", IP: "10.42.0.13", AdditionalIPsJSON: `[{"ip":"10.42.0.13","purpose":"management"},{"ip":"172.24.8.13","purpose":["out_of_band","business"]}]`}}},
		{Name: "仅带外", Interfaces: []CmdbAssetInterface{{Name: "ilo", IP: "10.42.0.14", AdditionalIPsJSON: `[{"ip":"10.42.0.14","purpose":"out_of_band"}]`}}},
		{Name: "用途未知", Interfaces: []CmdbAssetInterface{{Name: "eth2", IP: "172.24.8.15"}}},
	} {
		asset := asset
		if _, err := s.CreateCmdbAssetManual(&asset); err != nil {
			t.Fatal(err)
		}
	}
	// 精确台账曾归大段时，新增的小段仍按最长前缀决定网络类型。
	if _, err := s.db.Exec(`UPDATE ip_pool SET subnet='业务大段' WHERE project_id=? AND ip LIKE '172.24.8.%'`, scope.ProjectID); err != nil {
		t.Fatal(err)
	}
	for _, filter := range []struct {
		value string
		want  int
	}{{"专网", 3}, {CmdbAssetUnconfiguredFilter, 3}, {"外网", 0}} {
		query := CmdbAssetQuery{NetType: filter.value, Page: 1, PageSize: 1}
		list, total, err := s.QueryCmdbAssetsForProject(scope, query)
		if err != nil {
			t.Fatal(err)
		}
		exported, err := s.AllCmdbAssetsForProject(scope, query)
		if err != nil {
			t.Fatal(err)
		}
		if total != filter.want || len(exported) != filter.want || (filter.want > 0 && len(list) != 1) {
			t.Fatalf("网络筛选与全部导出不一致: filter=%s total=%d list=%+v export=%+v", filter.value, total, list, exported)
		}
		for _, asset := range exported {
			want := filter.value
			if want == CmdbAssetUnconfiguredFilter {
				want = ""
			}
			if asset.BusinessNetworkType != want {
				t.Fatalf("导出网络来源不一致: %+v", asset)
			}
		}
	}
}

func TestQueryCmdbAssetsSortWhitelistRejectsUnknownField(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A", AssetCode: "ZC1", Status: "在线"})

	// 非白名单字段必须回退到默认排序，而不是拼接进 SQL
	if _, _, err := s.QueryCmdbAssets(CmdbAssetQuery{SortBy: "name; DROP TABLE cmdb_assets", Page: 1, PageSize: 10}); err != nil {
		t.Fatalf("非法排序字段应回退默认排序而非报错: %v", err)
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets`).Scan(&cnt); err != nil {
		t.Fatalf("表应当仍然存在: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("数据不应被破坏，实际 %d 行", cnt)
	}
}

func TestQueryCmdbAssetsInfrastructureScope(t *testing.T) {
	s := newCmdbTestStore(t)
	// 分类必须显式声明 asset_scope：基础设施范围以该字段为准，名称启发式不再参与判定。
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var switchCategoryID, terminalCategoryID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE project_id=? AND asset_scope='infrastructure' AND name='交换机'`, scope.ProjectID).Scan(&switchCategoryID); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE project_id=? AND asset_scope='terminal' AND name='云桌面终端'`, scope.ProjectID).Scan(&terminalCategoryID); err != nil {
		t.Fatal(err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "核心交换机", CategoryID: switchCategoryID})
	insertCmdbAsset(t, s, CmdbAsset{Name: "云桌面终端", CategoryID: terminalCategoryID})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{
		ResourceScope: "infrastructure",
		Page:          1,
		PageSize:      20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].CategoryName != "交换机" {
		t.Fatalf("基础设施筛选异常: total=%d list=%+v", total, list)
	}
}

func TestQueryCmdbAssetsInfrastructureScopeIncludesHyperconverged(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	categoryID, err := s.CreateCmdbTaxonomyForProject(scopeA, "categories", "超融合", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]bool{}
	for _, fixture := range []struct {
		deviceType string
		categoryID int64
	}{
		{"超融合", categoryID},
		{"超融合", 0},
		{"hyperconverged", 0},
		{"HCI", 0},
		{"", categoryID},
	} {
		id, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{
			Name: "超融合图标验收", AssetClass: "physical", DeviceType: fixture.deviceType, CategoryID: fixture.categoryID,
		})
		if err != nil {
			t.Fatal(err)
		}
		want[id] = true
	}
	// 终端与其他项目的超融合设备不能混入当前项目的基础设施列表。
	if _, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "终端", DeviceType: "台式电脑"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "其他项目超融合", DeviceType: "hyperconverged"}); err != nil {
		t.Fatal(err)
	}
	query := CmdbAssetQuery{ResourceScope: "infrastructure", Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssetsForProject(scopeA, query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 5 || len(list) != 5 {
		t.Fatalf("超融合设备被漏掉: total=%d list=%+v", total, list)
	}
	for _, asset := range list {
		if !want[asset.ID] || asset.ProjectID != scopeA.ProjectID {
			t.Fatalf("基础设施列表混入无关资产: %+v", asset)
		}
	}
	exported, err := s.AllCmdbAssetsForProject(scopeA, query)
	if err != nil || len(exported) != 5 {
		t.Fatalf("导出与列表筛选范围不一致: len=%d err=%v", len(exported), err)
	}
}

func TestQueryCmdbAssetsCategoryFilterDoesNotORLegacyDeviceType(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var categoryID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE project_id=? AND asset_scope='infrastructure' AND name='交换机'`, scope.ProjectID).Scan(&categoryID); err != nil {
		t.Fatal(err)
	}
	categoryAssetID := insertCmdbAsset(t, s, CmdbAsset{Name: "分类交换机", CategoryID: categoryID})
	legacyAssetID := insertCmdbAsset(t, s, CmdbAsset{Name: "历史交换机", DeviceType: "switch"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "历史路由器", DeviceType: "router"})
	result, err := s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('网络设备', 0, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	networkCategoryID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	classifiedSwitchID := insertCmdbAsset(t, s, CmdbAsset{Name: "已归类交换机", CategoryID: networkCategoryID, DeviceType: "交换机"})

	query := CmdbAssetQuery{CategoryID: categoryID, DeviceType: "switch", Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssets(query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("选择分类时必须按 category_id 精确匹配: total=%d list=%+v", total, list)
	}
	if list[0].ID != categoryAssetID {
		t.Fatalf("分类筛选返回了非该分类设备: %+v", list[0])
	}
	exported, err := s.AllCmdbAssets(query)
	if err != nil || len(exported) != 1 || exported[0].ID != categoryAssetID {
		t.Fatalf("导出与列表的精确分类筛选不一致: len=%d err=%v", len(exported), err)
	}

	typeOnly, typeTotal, err := s.QueryCmdbAssets(CmdbAssetQuery{DeviceType: "switch", Page: 1, PageSize: 20})
	if err != nil || typeTotal != 3 || len(typeOnly) != 3 || typeOnly[0].ID != categoryAssetID || typeOnly[1].ID != legacyAssetID || typeOnly[2].ID != classifiedSwitchID {
		t.Fatalf("设备类型筛选应同时返回已分类资产与未分类旧记录: total=%d list=%+v err=%v", typeTotal, typeOnly, err)
	}
	typeExport, err := s.AllCmdbAssets(CmdbAssetQuery{DeviceType: "switch"})
	if err != nil || len(typeExport) != 3 {
		t.Fatalf("设备类型导出应与列表一致: len=%d err=%v", len(typeExport), err)
	}
}

func TestQueryCmdbAssetsUnassignedGroup(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "未分组服务器一", DeviceType: "server"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "未分组服务器二", DeviceType: "server"})
	result, err := s.db.Exec(`INSERT INTO cmdb_groups(name, sort_order) VALUES ('已分组设备', 0)`)
	if err != nil {
		t.Fatal(err)
	}
	groupID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "已分组服务器", DeviceType: "server", GroupID: groupID})

	query := CmdbAssetQuery{GroupID: -1, Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssets(query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(list) != 2 {
		t.Fatalf("未分组筛选只应返回 group_id 为空或为零的记录: total=%d list=%+v", total, list)
	}
	exported, err := s.AllCmdbAssets(query)
	if err != nil || len(exported) != 2 {
		t.Fatalf("导出与列表的未分组筛选不一致: len=%d err=%v", len(exported), err)
	}
}

func TestCmdbAssetFiltersMatchActualOwnerBrandModelAndNetworkFields(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务地址池", CIDR: "192.0.2.0/24", Category: "专网"}); err != nil {
		t.Fatal(err)
	}
	managedID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "边界交换机", DeviceType: "switch", Vendor: "华三", Model: "S5560X",
		Owner: "张三", Department: "信息处", Status: "在线", BizIP: "192.0.2.30", NetType: "外网",
	})
	if _, err := s.db.Exec(`INSERT INTO cmdb_asset_interfaces(asset_id,name,network_zone,net_zone) VALUES (?, '管理口', '设备管理网', '')`, managedID); err != nil {
		t.Fatal(err)
	}
	unconfiguredID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "未配网络设备", DeviceType: "router", Vendor: "华三", Status: "离线",
	})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{
		Owner: "张三", Department: "信息处", Vendor: "华三", Model: "S5560X",
		NetType: "专网", Page: 1, PageSize: 20,
	})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != managedID {
		t.Fatalf("负责人、部门、品牌、型号和业务网络筛选必须取交集: total=%d list=%+v err=%v", total, list, err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachCmdbAssetInterfacesForProject(scope, list); err != nil {
		t.Fatal(err)
	}
	if len(list[0].Interfaces) != 1 || list[0].Interfaces[0].NetworkZone != "设备管理网" {
		t.Fatalf("列表数据应带回真实网络接口区域: %+v", list[0].Interfaces)
	}
	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{NetType: CmdbAssetUnconfiguredFilter, Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != unconfiguredID {
		t.Fatalf("未配置网络筛选必须按业务地址归属判断: total=%d list=%+v err=%v", total, list, err)
	}
}

func TestQueryCmdbAssetsLocationMatchesListExportAndUnconfigured(t *testing.T) {
	s := newCmdbTestStore(t)
	roomID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "核心服务器", DeviceType: "server", Room: "东区机房 301", DataCenter: "常州中院数据中心",
	})
	legacyID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "历史存储", DeviceType: "storage", Area: "灾备机房", CabinetPos: "B08",
	})
	emptyID := insertCmdbAsset(t, s, CmdbAsset{Name: "待上架服务器", DeviceType: "server"})

	for _, fixture := range []struct {
		location string
		wantID   int64
	}{
		{location: "东区机房 301", wantID: roomID},
		{location: "常州中院数据中心", wantID: roomID},
		{location: "灾备机房", wantID: legacyID},
		{location: "B08", wantID: legacyID},
		{location: CmdbAssetUnconfiguredFilter, wantID: emptyID},
	} {
		query := CmdbAssetQuery{Location: fixture.location, Page: 1, PageSize: 20}
		list, total, err := s.QueryCmdbAssets(query)
		if err != nil || total != 1 || len(list) != 1 || list[0].ID != fixture.wantID {
			t.Fatalf("位置筛选 %q 错误: total=%d list=%+v err=%v", fixture.location, total, list, err)
		}
		exported, err := s.AllCmdbAssets(query)
		if err != nil || len(exported) != 1 || exported[0].ID != fixture.wantID {
			t.Fatalf("位置筛选 %q 的列表与导出不一致: list=%+v err=%v", fixture.location, exported, err)
		}
	}
}

func TestCmdbAssetLocationSummaryUsesActualLocationFields(t *testing.T) {
	got := CmdbAssetLocationSummary(CmdbAsset{
		Room: "东区机房 301", DataCenter: "常州中院数据中心", Floor: "3 楼",
		CabinetName: "A01", CabinetRow: "2 排", CabinetCol: 3, StartU: 10, HeightU: 2,
	})
	want := "东区机房 301 · 常州中院数据中心 · 3 楼 · A01 · 2 排 / 3 列 · 10U–11U"
	if got != want {
		t.Fatalf("位置摘要错误: got=%q want=%q", got, want)
	}
	if got := CmdbAssetLocationSummary(CmdbAsset{Area: "灾备机房", CabinetPos: "B08", UStart: 20, UHeight: 1}); got != "灾备机房 · B08 · 20U" {
		t.Fatalf("旧位置字段没有兼容: %q", got)
	}
}
