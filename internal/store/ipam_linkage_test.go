package store

import (
	"bytes"
	"encoding/json"
	"github.com/xuri/excelize/v2"
	"strings"
	"testing"
)

func TestIPAMInfrastructureImportUsesSameOccupationWrite(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "导入", CIDR: "10.101.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	workbook := excelize.NewFile()
	defer workbook.Close()
	for cell, value := range map[string]string{"A1": "资产名称", "B1": "管理IP", "A2": "导入设备", "B2": "10.101.0.10"} {
		if err := workbook.SetCellValue("Sheet1", cell, value); err != nil {
			t.Fatal(err)
		}
	}
	data, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.CommitCmdbImport(bytes.NewReader(data.Bytes()))
	if err != nil || result.Created != 1 {
		t.Fatalf("导入失败: %+v %v", result, err)
	}
	rows, _, err := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil || len(rows) != 1 || rows[0].OwnerType != "infrastructure" || rows[0].Status != "在用" {
		t.Fatalf("导入必须使用同一占用写入: %+v %v", rows, err)
	}
}

func TestIPAMApplicationUsesSelectedBusinessAddress(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务网", CIDR: "10.89.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "承载服务器", DeviceType: "服务器", MgmtIP: "10.89.0.10", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.89.0.11", AdditionalIPsJSON: `[{"ip":"10.89.0.11","purpose":"business"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"系统一", "系统二"} {
		app := ServerApp{AppName: name, CmdbAssetID: id, AccessURL: "https://example.test"}
		if err = json.Unmarshal([]byte(`{"service_ip":"10.89.0.11"}`), &app); err != nil {
			t.Fatal(err)
		}
		if _, err = s.CreateApp(&app); err != nil {
			t.Fatal(err)
		}
	}
	apps, _, err := s.QueryAllApps("", "", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 2 || apps[0].ServerBizIP != "10.89.0.11" {
		t.Fatalf("应显示明确选中的业务 IP: %+v", apps)
	}
	rows, total, _ := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if total != 2 {
		t.Fatalf("共享设备地址不能重复占用: %+v", rows)
	}
	var poolID int64
	for _, row := range rows {
		if row.IP == "10.89.0.11" {
			poolID = row.ID
			if row.OwnerType != "infrastructure" {
				t.Fatalf("共享地址应归设备占用: %+v", row)
			}
		}
	}
	if err = s.ReleaseIP(poolID); err == nil || !strings.Contains(err.Error(), "系统") {
		t.Fatalf("释放应列出应用依赖: %v", err)
	}
	a, ifaces, _ := s.GetCmdbAsset(id)
	a.Interfaces = ifaces
	a.Interfaces[0].IP = "10.89.0.12"
	a.Interfaces[0].AdditionalIPsJSON = `[{"ip":"10.89.0.12","purpose":"business"}]`
	if err = s.UpdateCmdbAssetManual(a); err == nil || !strings.Contains(err.Error(), "系统") {
		t.Fatalf("移除应用引用的地址必须回滚: %v", err)
	}
	actual, _, _ := s.GetCmdbAssetForProject(scope, id)
	if actual.MgmtIP != "10.89.0.10" {
		t.Fatal("失败破坏资产")
	}
	bad := ServerApp{AppName: "错误系统", CmdbAssetID: id}
	_ = json.Unmarshal([]byte(`{"service_ip":"10.89.0.10"}`), &bad)
	if _, err = s.CreateApp(&bad); err == nil {
		t.Fatal("不能把管理地址选作业务地址")
	}
	if _, err = s.CreateApp(&ServerApp{AppName: "未选择系统", CmdbAssetID: id}); err != nil {
		t.Fatal(err)
	}
	apps, _, _ = s.QueryAllApps("未选择系统", "", "", 1, 20)
	if apps[0].ServerBizIP != "" {
		t.Fatal("未选择不得回退管理地址")
	}
}

func TestIPAMReplacementRetainsSharedAddressAndReleasesUnusedAddress(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	first, _ := s.CreateIPEntry(&IPEntry{Subnet: "业务", IP: "10.90.0.10", Status: "空闲"})
	next, _ := s.CreateIPEntry(&IPEntry{Subnet: "业务", IP: "10.90.0.11", Status: "保留"})
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备", MgmtIP: "10.90.0.10", BizIP: "10.90.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AllocateIPToOwnerForProject(scope, first, "infrastructure", id, "biz_ip", ""); err != nil {
		t.Fatalf("同设备同地址应可重复选择: %v", err)
	}
	if err = s.AllocateIPToOwnerForProject(scope, next, "infrastructure", id, "mgmt_ip", ""); err != nil {
		t.Fatal(err)
	}
	row, _ := s.GetIPEntry(first)
	if row.Status != "在用" {
		t.Fatal("业务用途仍存在不能释放")
	}
	if err = s.AllocateIPToOwnerForProject(scope, next, "infrastructure", id, "biz_ip", ""); err != nil {
		t.Fatal(err)
	}
	row, _ = s.GetIPEntry(first)
	if row.Status != "空闲" {
		t.Fatalf("最后用途替换后必须释放旧地址: %+v", row)
	}
}

func TestIPAMRegistersEveryDeviceAddressOnce(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务网", CIDR: "10.88.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "服务器", MgmtIP: "10.88.0.10", BizIP: "10.88.0.10", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.88.0.10", AdditionalIPsJSON: `[{"ip":"10.88.0.10","purpose":["management","business"]},{"ip":"10.88.0.11","purpose":"business"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	rows, total, err := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil || total != 2 {
		t.Fatalf("应补入且只占用两个地址: total=%d rows=%+v err=%v", total, rows, err)
	}
	for _, row := range rows {
		if row.Status != "在用" || row.OwnerID != id || row.OwnerType != "infrastructure" {
			t.Fatalf("占用未同步: %+v", row)
		}
	}
	a, ifaces, err := s.GetCmdbAsset(id)
	if err != nil {
		t.Fatal(err)
	}
	a.Interfaces = ifaces
	a.Interfaces[0].AdditionalIPsJSON = `[{"ip":"10.88.0.10","purpose":"management"}]`
	if err = s.UpdateCmdbAssetManual(a); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = s.db.QueryRow(`SELECT status FROM ip_pool WHERE ip='10.88.0.11'`).Scan(&status); err != nil || status != "空闲" {
		t.Fatalf("移除附加地址未释放: %s %v", status, err)
	}
}

func TestIPAMFollowingConnectionTracksOnlyItsAddress(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备", MgmtIP: "10.91.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	following := CmdbNetcattyLink{AssetType: "infrastructure", AssetID: id, HostID: "created-host", Address: "10.91.0.10"}
	_ = json.Unmarshal([]byte(`{"follow_asset_ip":true}`), &following)
	if _, err = s.SaveCmdbNetcattyLinkForProject(scope, &following); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: id, HostID: "existing-host", Address: "nat.example.test"}); err != nil {
		t.Fatal(err)
	}
	a, _, _ := s.GetCmdbAsset(id)
	a.MgmtIP = "10.91.0.11"
	a.ManageIP = a.MgmtIP
	if err = s.UpdateCmdbAssetManual(a); err != nil {
		t.Fatal(err)
	}
	links, err := s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", id)
	if err != nil {
		t.Fatal(err)
	}
	for _, link := range links {
		if link.HostID == "created-host" && link.Address != "10.91.0.11" {
			t.Fatalf("跟随连接未保存新目标: %+v", link)
		}
		if link.HostID == "existing-host" && link.Address != "nat.example.test" {
			t.Fatal("独立主机被改写")
		}
	}
	a.MgmtIP = ""
	a.ManageIP = ""
	if err = s.UpdateCmdbAssetManual(a); err == nil || !strings.Contains(err.Error(), "连接") {
		t.Fatalf("删除跟随地址必须先处理连接: %v", err)
	}
	a, _, _ = s.GetCmdbAsset(id)
	if a.MgmtIP != "10.91.0.11" {
		t.Fatal("失败未回滚")
	}
}

func TestIPAMArchivingIndependentApplicationPreservesVIP(t *testing.T) {
	s := newCmdbTestStore(t)
	_, err := s.CreateIPSubnet(&IPSubnet{Name: "VIP", CIDR: "10.92.0.0/24"})
	if err != nil {
		t.Fatal(err)
	}
	app := ServerApp{AppName: "独立系统"}
	_ = json.Unmarshal([]byte(`{"service_ip":"10.92.0.10"}`), &app)
	id, err := s.CreateApp(&app)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteApp(id); err != nil {
		t.Fatal(err)
	}
	var status, ownerType string
	var ownerID int64
	if err = s.db.QueryRow(`SELECT status,owner_type,owner_id FROM ip_pool WHERE ip='10.92.0.10'`).Scan(&status, &ownerType, &ownerID); err != nil || status != "在用" || ownerType != "application" || ownerID != id {
		t.Fatalf("注销归档必须保留 VIP 归属: status=%s owner=%s/%d err=%v", status, ownerType, ownerID, err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	got, logs, err := s.GetAppForProject(scope, id)
	if err != nil || got.ServiceIP != "10.92.0.10" || got.Status != "已注销" || len(logs) != 2 {
		t.Fatalf("注销归档丢失应用地址或履历: app=%+v logs=%+v err=%v", got, logs, err)
	}
}

func TestIPAMRejectsOccupiedPoolAddressRewrite(t *testing.T) {
	s := newCmdbTestStore(t)
	poolID, _ := s.CreateIPEntry(&IPEntry{Subnet: "业务", IP: "10.93.0.10", Status: "空闲"})
	_, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备", MgmtIP: "10.93.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := s.GetIPEntry(poolID)
	row.IP = "10.93.0.11"
	if err = s.UpdateIPEntry(row); err == nil {
		t.Fatal("已占用池记录不能直接改地址而不改资产")
	}
}

func TestIPAMCannotRemoveBusinessPurposeUsedByApplication(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "共享管理业务设备", DeviceType: "服务器", MgmtIP: "10.95.0.10", BizIP: "10.95.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateApp(&ServerApp{AppName: "依赖业务用途", CmdbAssetID: id, ServiceIP: "10.95.0.10"}); err != nil {
		t.Fatal(err)
	}
	a, _, _ := s.GetCmdbAsset(id)
	a.BizIP = ""
	if err = s.UpdateCmdbAssetManual(a); err == nil || !strings.Contains(err.Error(), "依赖业务用途") {
		t.Fatalf("保留管理用途不能掩盖应用业务依赖: %v", err)
	}
	a, _, _ = s.GetCmdbAsset(id)
	if a.BizIP != "10.95.0.10" {
		t.Fatal("失败应回滚业务用途")
	}
}

func TestIPAMSharedBusinessSelectionAppearsInLegacyServerDetail(t *testing.T) {
	s := newCmdbTestStore(t)
	serverID, err := s.CreateServer(&PhysicalServer{DeviceName: "兼容服务器", BizIP: "10.96.0.10"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateApp(&ServerApp{AppName: "兼容系统", ServerID: serverID, ServiceIP: "10.96.0.10"}); err != nil {
		t.Fatal(err)
	}
	_, apps, err := s.GetServer(serverID)
	if err != nil || len(apps) != 1 || apps[0].ServiceIP != "10.96.0.10" {
		t.Fatalf("旧服务器详情也应读取所选业务地址: %+v %v", apps, err)
	}
}

func TestIPAMLateSubnetStillKeepsBusinessIPOwnedByDevice(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "先录入设备", DeviceType: "服务器", BizIP: "10.97.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateIPSubnet(&IPSubnet{Name: "后建网段", CIDR: "10.97.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateApp(&ServerApp{AppName: "系统", CmdbAssetID: id, ServiceIP: "10.97.0.10"}); err != nil {
		t.Fatal(err)
	}
	rows, _, err := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OwnerType != "infrastructure" || rows[0].OwnerID != id {
		t.Fatalf("业务地址应归承载设备而非应用: %+v", rows)
	}
}

func TestIPAMConflictRollsBackAssetInterfacesAndPreviousOccupation(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "事务", CIDR: "10.98.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备一", MgmtIP: "10.98.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备二", MgmtIP: "10.98.0.11"}); err != nil {
		t.Fatal(err)
	}
	a, _, _ := s.GetCmdbAsset(id)
	a.MgmtIP = "10.98.0.11"
	a.ManageIP = a.MgmtIP
	a.Interfaces = []CmdbAssetInterface{{Name: "新接口", IP: "10.98.0.12"}}
	if err = s.UpdateCmdbAssetManual(a); err == nil {
		t.Fatal("重复地址应拒绝")
	}
	a, ifaces, _ := s.GetCmdbAsset(id)
	if a.MgmtIP != "10.98.0.10" || len(ifaces) != 0 {
		t.Fatalf("冲突必须回滚资产和接口: %+v %+v", a, ifaces)
	}
	rows, _, _ := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if len(rows) != 2 {
		t.Fatal("冲突时不能留下补池副作用")
	}
	for _, row := range rows {
		if row.Status != "在用" {
			t.Fatalf("原占用被释放: %+v", row)
		}
	}
}

func TestIPAMFollowingAdditionalAddressKeepsInterfaceIdentity(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "接口设备", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.99.0.10", AdditionalIPsJSON: `[{"ip":"10.99.0.11","purpose":"out_of_band"}]`}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: id, HostID: "additional", Address: "10.99.0.11", FollowAssetIP: true}); err != nil {
		t.Fatal(err)
	}
	a, ifaces, _ := s.GetCmdbAsset(id)
	a.Interfaces = ifaces
	a.Interfaces[0].AdditionalIPsJSON = `[{"ip":"10.99.0.12","purpose":"out_of_band"}]`
	if err = s.UpdateCmdbAssetManual(a); err != nil {
		t.Fatalf("明确替换同接口同用途地址应跟随: %v", err)
	}
	links, _ := s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", id)
	if links[0].Address != "10.99.0.12" {
		t.Fatalf("附加地址跟随错误: %+v", links)
	}
}

func TestIPAMTerminalCannotStealInfrastructureOccupation(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "混合网", CIDR: "10.100.0.0/24"}); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "服务器", MgmtIP: "10.100.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateAsset(&Asset{AssetCode: "普通终端", DeviceType: "台式电脑", IP: "10.100.0.10"}, "测试"); err == nil {
		t.Fatal("终端不能覆盖基础设施占用")
	}
	rows, _, _ := s.QueryIPEntries(IPEntryQuery{Page: 1, PageSize: 20})
	if rows[0].OwnerType != "infrastructure" || rows[0].OwnerID != id {
		t.Fatal("失败必须保留占用归属")
	}
}

func TestIPAMSnapshotKeepsApplicationHostAndAddressReferences(t *testing.T) {
	remote, rs := openSnapshotTestStore(t)
	local, ls := openSnapshotTestStore(t)
	project, _ := remote.ResolveProject(rs)
	alignSnapshotProject(t, local, ls, project.SyncID)
	if _, err := local.CreateCmdbAssetManual(&CmdbAsset{Name: "本地已有设备"}); err != nil {
		t.Fatal(err)
	}
	id, err := remote.CreateCmdbAssetManual(&CmdbAsset{Name: "远端承载设备", DeviceType: "服务器", BizIP: "10.94.0.10"})
	if err != nil {
		t.Fatal(err)
	}
	app := ServerApp{AppName: "共享业务", CmdbAssetID: id, ServiceIP: "10.94.0.10"}
	if _, err = remote.CreateApp(&app); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(rs, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = local.ApplyCmdbSnapshot(ls, snapshot); err != nil {
		t.Fatal(err)
	}
	apps, _, err := local.QueryAllApps("共享业务", "", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 || apps[0].ServerName != "远端承载设备" || apps[0].ServiceIP != "10.94.0.10" {
		t.Fatalf("快照应以同步引用还原承载对象与业务地址: %+v", apps)
	}
}

func TestIPAMUnmanagedAddressIsExplicitInRelations(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "离线设备", MgmtIP: "192.0.2.10"})
	if err != nil {
		t.Fatal(err)
	}
	scope, _ := s.DefaultProjectScope()
	a, ifaces, _ := s.GetCmdbAsset(id)
	relations, err := s.CmdbAssetRelationsForProject(scope, a, ifaces)
	if err != nil || len(relations.IPAM) != 1 || relations.IPAM[0].Status != "未纳入 IPAM" {
		t.Fatalf("无网段应保留地址并明确标记: %+v %v", relations, err)
	}
}

// 历史手工池条目已经纳入 IPAM；没有网段定义不应使既有条目失效。
func TestIPAMExistingManualPoolEntryDoesNotRequireSubnetDefinition(t *testing.T) {
	s := newCmdbTestStore(t)
	poolID, err := s.CreateIPEntry(&IPEntry{Subnet: "历史手工池", IP: "192.0.2.25", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "历史地址设备", MgmtIP: "192.0.2.25"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.GetIPEntry(poolID)
	if err != nil || row.Status != "在用" || row.OwnerID != id || row.OwnerType != "infrastructure" {
		t.Fatalf("已有池条目应保持可分配: %+v %v", row, err)
	}
}

func TestIPAMReleaseRejectsInterfaceDependency(t *testing.T) {
	s := newCmdbTestStore(t)
	poolID, err := s.CreateIPEntry(&IPEntry{Subnet: "业务网", IP: "10.88.0.10", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "设备", MgmtIP: "10.88.0.10", Interfaces: []CmdbAssetInterface{{Name: "eth0", IP: "10.88.0.10"}}})
	if err != nil {
		t.Fatal(err)
	}
	err = s.ReleaseIP(poolID)
	if err == nil || !strings.Contains(err.Error(), "eth0") {
		t.Fatalf("必须列出接口依赖并拒绝释放: %v", err)
	}
	a, ifaces, _ := s.GetCmdbAsset(id)
	row, _ := s.GetIPEntry(poolID)
	if a.MgmtIP != "10.88.0.10" || ifaces[0].IP != "10.88.0.10" || row.Status != "在用" {
		t.Fatal("释放失败必须保留资产和占用")
	}
}
