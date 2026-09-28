package store

import (
	"encoding/json"
	"strings"
	"testing"
)

// 删除 IP 不得静默造成「资产台账」与「IP 池」不一致：
// 被资产占用时先拒绝，强制删除也不得改动资产。
func TestDeleteIPEntryGuardsAssetOccupation(t *testing.T) {
	s := newCmdbTestStore(t)

	// 无资产占用：直接可删
	freeID, err := s.CreateIPEntry(&IPEntry{Subnet: "7段", IP: "138.64.7.50", Status: "空闲"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	if err := s.DeleteIPEntry(freeID, false); err != nil {
		t.Fatalf("未被占用的 IP 应可直接删除: %v", err)
	}

	// 被资产占用：必须拒绝
	usedID, err := s.CreateIPEntry(&IPEntry{Subnet: "7段", IP: "138.64.7.51", Status: "在用", Account: "张三"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-IP-DEL", UserName: "张三", IP: "138.64.7.51", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	err = s.DeleteIPEntry(usedID, false)
	if err == nil {
		t.Fatalf("被资产占用时必须拒绝删除")
	}
	if !strings.Contains(err.Error(), "正被资产") || !strings.Contains(err.Error(), "ZC-IP-DEL") {
		t.Fatalf("错误信息应指明被哪台资产占用，实际: %v", err)
	}
	if _, err := s.GetIPEntry(usedID); err != nil {
		t.Fatalf("拒绝删除后 IP 条目应仍然存在: %v", err)
	}

	// 强制删除：允许，但资产一行都不能变
	if err := s.DeleteIPEntry(usedID, true); err != nil {
		t.Fatalf("强制删除应成功: %v", err)
	}
	assets, err := s.AllAssets()
	if err != nil {
		t.Fatalf("读取资产失败: %v", err)
	}
	found := false
	for _, a := range assets {
		if a.AssetCode == "ZC-IP-DEL" {
			found = true
			if a.IP != "138.64.7.51" || a.UserName != "张三" {
				t.Fatalf("强制删除 IP 不得改动资产，实际 %+v", a)
			}
		}
	}
	if !found {
		t.Fatalf("强制删除 IP 不得删除资产")
	}
}

func TestNormalizeIPPoolIPsIsIdempotentAndKeepsBoxIP(t *testing.T) {
	s := newCmdbTestStore(t)

	// 复合串（外网段历史迁移遗留）
	if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
		VALUES ('外网','191.162.17.1 (盒子:180.161.30.1)','','','模板临时使用','在用','外网云桌面')`); err != nil {
		t.Fatalf("准备数据失败: %v", err)
	}
	// 纯 IP（不应被改动）
	if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
		VALUES ('7段','138.64.7.2','速裁','','丁民','在用','')`); err != nil {
		t.Fatalf("准备数据失败: %v", err)
	}

	n, err := s.NormalizeIPPoolIPs()
	if err != nil {
		t.Fatalf("规范化失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应规范化 1 条，实际 %d", n)
	}

	var ip, remark string
	if err := s.db.QueryRow(`SELECT ip, remark FROM ip_pool WHERE subnet='外网'`).Scan(&ip, &remark); err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	if ip != "191.162.17.1" {
		t.Fatalf("ip 应为纯地址，实际 %s", ip)
	}
	if BoxIPFromRemark(remark) != "180.161.30.1" {
		t.Fatalf("盒子地址应保留在备注中，实际备注=%s", remark)
	}

	// 再跑一次必须幂等
	if again, err := s.NormalizeIPPoolIPs(); err != nil {
		t.Fatalf("重复规范化失败: %v", err)
	} else if again != 0 {
		t.Fatalf("重复规范化应为 0，实际 %d", again)
	}
}

func TestQueryIPEntriesSortsNumericallyAndLinksAssets(t *testing.T) {
	s := newCmdbTestStore(t)

	for _, ip := range []string{"138.64.7.9", "138.64.7.10", "138.64.7.2", "138.64.7.254"} {
		if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
			VALUES ('7段',?,'','','','空闲','')`, ip); err != nil {
			t.Fatalf("准备数据失败: %v", err)
		}
	}
	// 终端 IP 与业务 IP 各挂一台资产
	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-IP-1", UserName: "张三", IP: "138.64.7.10", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	list, total, err := s.QueryIPEntries(IPEntryQuery{Subnet: "7段", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 4 {
		t.Fatalf("应为 4 条，实际 %d", total)
	}
	// 数值排序：2 < 9 < 10 < 254（字符串排序会把 10 排到 9 前面）
	want := []string{"138.64.7.2", "138.64.7.9", "138.64.7.10", "138.64.7.254"}
	for i, w := range want {
		if list[i].IP != w {
			t.Fatalf("第 %d 位应为 %s，实际 %s（排序未按数值）", i, w, list[i].IP)
		}
	}
	// 占用资产联动
	for _, e := range list {
		if e.IP == "138.64.7.10" {
			if e.AssetCode != "ZC-IP-1" || e.AssetUser != "张三" {
				t.Fatalf("138.64.7.10 应关联到 ZC-IP-1，实际 %+v", e)
			}
		}
	}
}

func TestQueryIPEntriesLinksByBoxAddressForWan(t *testing.T) {
	s := newCmdbTestStore(t)

	if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
		VALUES ('外网','191.162.17.11','','','吴奕','在用','外网云桌面｜盒子 180.161.30.11')`); err != nil {
		t.Fatalf("准备数据失败: %v", err)
	}
	// 资产的 terminal_ip 存的是盒子地址
	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-WAN-1", UserName: "吴奕", TerminalIP: "180.161.30.11", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备资产失败: %v", err)
	}

	list, _, err := s.QueryIPEntries(IPEntryQuery{Subnet: "外网", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if len(list) != 1 || list[0].AssetCode != "ZC-WAN-1" {
		t.Fatalf("外网应通过盒子地址关联到资产，实际 %+v", list)
	}
}

func TestIPAllocateAndRelease(t *testing.T) {
	s := newCmdbTestStore(t)

	id, err := s.CreateIPEntry(&IPEntry{Subnet: "9段", IP: "138.64.9.200", Status: "空闲"})
	if err != nil {
		t.Fatalf("新增失败: %v", err)
	}
	// 格式与重复校验
	if _, err := s.CreateIPEntry(&IPEntry{Subnet: "9段", IP: "not-an-ip"}); err == nil {
		t.Fatalf("非法 IP 必须报错")
	}
	if _, err := s.CreateIPEntry(&IPEntry{Subnet: "9段", IP: "138.64.9.200"}); err == nil {
		t.Fatalf("重复 IP 必须报错")
	}
	// 未填使用人/部门不得分配
	if err := s.AllocateIP(id, "", "", "", ""); err == nil {
		t.Fatalf("缺少使用人与部门时必须拒绝分配")
	}
	// 正常分配
	if err := s.AllocateIP(id, "立案庭", "张三", "302", "新入职"); err != nil {
		t.Fatalf("分配失败: %v", err)
	}
	got, _ := s.GetIPEntry(id)
	if got.Status != "在用" || got.Account != "张三" || got.Department != "立案庭" || got.Room != "302" {
		t.Fatalf("分配结果不正确: %+v", got)
	}
	// 已占用不得重复分配
	if err := s.AllocateIP(id, "执行局", "李四", "", ""); err == nil {
		t.Fatalf("已占用时必须拒绝再次分配")
	}
	// 释放
	if err := s.ReleaseIP(id); err != nil {
		t.Fatalf("释放失败: %v", err)
	}
	got, _ = s.GetIPEntry(id)
	if got.Status != "空闲" || got.Account != "" || got.Department != "" || got.Room != "" {
		t.Fatalf("释放后应清空占用信息: %+v", got)
	}
	// 空闲状态不得重复释放
	if err := s.ReleaseIP(id); err == nil {
		t.Fatalf("空闲状态重复释放必须报错")
	}
}

func TestIPPoolSummaryCountsAllRowsNotJustCurrentPage(t *testing.T) {
	s := newCmdbTestStore(t)

	for i := 0; i < 7; i++ {
		status := "空闲"
		if i < 3 {
			status = "在用"
		}
		if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
			VALUES ('7段',?,'','','',?,'')`, "138.64.7."+itoa(i+2), status); err != nil {
			t.Fatalf("准备数据失败: %v", err)
		}
	}

	sum, err := s.IPPoolSummaryData()
	if err != nil {
		t.Fatalf("汇总失败: %v", err)
	}
	if sum.Total != 7 || sum.Used != 3 || sum.Free != 4 {
		t.Fatalf("汇总应统计全量：total=7 used=3 free=4，实际 total=%d used=%d free=%d",
			sum.Total, sum.Used, sum.Free)
	}
	if len(sum.Subnets) != 1 {
		t.Fatalf("应有 1 个网段，实际 %d", len(sum.Subnets))
	}
	sub := sum.Subnets[0]
	if sub.RangeFrom != "138.64.7.2" || sub.RangeTo != "138.64.7.8" {
		t.Fatalf("地址范围错误: %s ~ %s", sub.RangeFrom, sub.RangeTo)
	}
	if sub.UsageRate != 42.9 {
		t.Fatalf("使用率应为 42.9，实际 %v", sub.UsageRate)
	}
}

func TestAllocateIPToAssetLinksAndReleaseClearsBothSides(t *testing.T) {
	s := newCmdbTestStore(t)
	assetID, err := s.CreateAsset(&Asset{AssetCode: "IP-LINK-1", DeviceType: "台式电脑", UserName: "张三", Department: "技术处", Room: "301", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	ipID, err := s.CreateIPEntry(&IPEntry{Subnet: "办公网", IP: "10.20.30.40", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AllocateIPToAsset(ipID, assetID, "ip", "自动关联"); err != nil {
		t.Fatalf("分配到资产失败: %v", err)
	}
	asset, _, _ := s.GetAsset(assetID)
	if asset.IP != "10.20.30.40" || asset.Department != "技术处" {
		t.Fatalf("IP 未同步到资产: %+v", asset)
	}
	entry, _ := s.GetIPEntry(ipID)
	if entry.Status != "在用" || entry.Account != "张三" || entry.Department != "技术处" || entry.Room != "301" {
		t.Fatalf("资产资料未同步到 IP: %+v", entry)
	}
	if err := s.ReleaseIP(ipID); err != nil {
		t.Fatalf("释放失败: %v", err)
	}
	asset, _, _ = s.GetAsset(assetID)
	if asset.IP != "" {
		t.Fatalf("释放后资产仍保留 IP: %+v", asset)
	}
}

func TestAssetIPWriteAutomaticallyUpdatesExistingPoolEntries(t *testing.T) {
	s := newCmdbTestStore(t)
	first, _ := s.CreateIPEntry(&IPEntry{Subnet: "办公网", IP: "10.20.30.41", Status: "空闲"})
	second, _ := s.CreateIPEntry(&IPEntry{Subnet: "办公网", IP: "10.20.30.42", Status: "空闲"})
	assetID, err := s.CreateAsset(&Asset{AssetCode: "IP-LINK-2", DeviceType: "台式电脑", UserName: "李四", Department: "办公室", Room: "302", IP: "10.20.30.41", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := s.GetIPEntry(first)
	if entry.Status != "在用" || entry.Account != "李四" {
		t.Fatalf("新增资产未占用已有 IP: %+v", entry)
	}
	asset, _, _ := s.GetAsset(assetID)
	asset.IP = "10.20.30.42"
	if err := s.UpdateAsset(asset, "测试"); err != nil {
		t.Fatal(err)
	}
	oldEntry, _ := s.GetIPEntry(first)
	newEntry, _ := s.GetIPEntry(second)
	if oldEntry.Status != "空闲" || newEntry.Status != "在用" || newEntry.Account != "李四" {
		t.Fatalf("修改资产 IP 未双向同步: old=%+v new=%+v", oldEntry, newEntry)
	}
}

func TestCreateIPEntryAutomaticallyDetectsExistingAsset(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateAsset(&Asset{AssetCode: "IP-LINK-3", DeviceType: "台式电脑", UserName: "王五", Department: "信息处", Room: "501", IP: "10.20.30.43", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateIPEntry(&IPEntry{Subnet: "办公网", IP: "10.20.30.43", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.GetIPEntry(id)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Status != "在用" || entry.Account != "王五" || entry.Department != "信息处" || entry.Room != "501" {
		t.Fatalf("新增 IP 未自动识别已有资产: %+v", entry)
	}
}

func TestCreateCmdbAssetPersistsDirectIPOwner(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	ipID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "管理网", IP: "10.20.30.44", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name: "接入交换机", DeviceType: "switch", MgmtIP: "10.20.30.44",
	})
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.GetIPEntryForProject(scope, ipID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Status != "在用" || entry.OwnerType != "infrastructure" || entry.OwnerID != assetID || entry.OwnerName != "接入交换机" {
		t.Fatalf("直接填写管理 IP 后未持久化占用关系: %+v", entry)
	}
	list, total, err := s.QueryIPEntriesForProject(scope, IPEntryQuery{Status: "在用", Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != ipID {
		t.Fatalf("在用筛选未命中直接字段占用: total=%d list=%+v err=%v", total, list, err)
	}
}

func TestUpdateCmdbAssetMovesDirectIPOwner(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	oldIPID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "管理网", IP: "10.20.30.45", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	newIPID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "管理网", IP: "10.20.30.46", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	asset := &CmdbAsset{Name: "汇聚交换机", DeviceType: "switch", MgmtIP: "10.20.30.45"}
	assetID, err := s.CreateCmdbAssetManualForProject(scope, asset)
	if err != nil {
		t.Fatal(err)
	}
	asset.ID = assetID
	asset.MgmtIP = "10.20.30.46"
	asset.ManageIP = "10.20.30.46"
	if err := s.UpdateCmdbAssetManualForProject(scope, asset); err != nil {
		t.Fatal(err)
	}
	oldEntry, _ := s.GetIPEntryForProject(scope, oldIPID)
	newEntry, _ := s.GetIPEntryForProject(scope, newIPID)
	if oldEntry.Status != "空闲" || oldEntry.OwnerType != "" || oldEntry.OwnerID != 0 {
		t.Fatalf("修改直接 IP 后旧地址未释放: %+v", oldEntry)
	}
	if newEntry.Status != "在用" || newEntry.OwnerType != "infrastructure" || newEntry.OwnerID != assetID {
		t.Fatalf("修改直接 IP 后新地址未占用: %+v", newEntry)
	}
}

func TestUpdateCmdbAssetRepairsStaleIPPoolOwnerForItsExistingIP(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	asset := &CmdbAsset{
		Name:       "核心交换机",
		DeviceType: "switch",
		MgmtIP:     "10.20.30.47",
		Interfaces: []CmdbAssetInterface{{Name: "管理口", IP: "10.20.30.47", IsPrimary: 1}},
	}
	assetID, err := s.CreateCmdbAssetManualForProject(scope, asset)
	if err != nil {
		t.Fatal(err)
	}
	ipID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "管理网", IP: "10.20.30.47", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE ip_pool SET status='在用',owner_type='',owner_id=0,owner_name='' WHERE id=? AND project_id=?`, ipID, scope.ProjectID); err != nil {
		t.Fatal(err)
	}

	stored, ifaces, err := s.GetCmdbAssetForProject(scope, assetID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Remark = "只修改资产归属等非 IP 字段时也应允许保存"
	stored.Interfaces = ifaces
	if err := s.UpdateCmdbAssetManualForProject(scope, stored); err != nil {
		t.Fatalf("资产继续使用原有 IP 时，不应被陈旧的 IPAM 归属元数据阻止保存: %v", err)
	}

	var status, ownerType, ownerName string
	var ownerID int64
	if err := s.db.QueryRow(`SELECT status,IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'') FROM ip_pool WHERE id=? AND project_id=?`, ipID, scope.ProjectID).
		Scan(&status, &ownerType, &ownerID, &ownerName); err != nil {
		t.Fatal(err)
	}
	if status != "在用" || ownerType != "infrastructure" || ownerID != assetID || ownerName != "核心交换机" {
		t.Fatalf("保存后应修复 IPAM 归属元数据: status=%q ownerType=%q ownerID=%d ownerName=%q", status, ownerType, ownerID, ownerName)
	}
}

// 如果 IPAM 只扫描终端台账，基础设施和业务系统已经使用的地址仍会显示为空闲。
func TestIPAMDetectsInfrastructureAndApplicationOwners(t *testing.T) {
	s := newCmdbTestStore(t)

	if _, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "核心交换机 A",
		AssetCode:  "NET-SW-001",
		DeviceType: "switch",
		Owner:      "网络管理员",
		MgmtIP:     "10.20.30.2",
		Interfaces: []CmdbAssetInterface{{Name: "mgmt0", IP: "10.20.30.2", IsPrimary: 1}},
	}); err != nil {
		t.Fatal(err)
	}
	serverID, err := s.CreateServer(&PhysicalServer{
		AssetCode: "SRV-001", DeviceName: "应用服务器", BizIP: "10.20.30.10", Status: "运行中",
	}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateApp(&ServerApp{ServerID: serverID, AppName: "审判业务系统", Owner: "应用管理员", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}

	for _, ip := range []string{"10.20.30.2", "10.20.30.10"} {
		if _, err := s.CreateIPEntry(&IPEntry{Subnet: "业务网", IP: ip, Status: "空闲"}); err != nil {
			t.Fatal(err)
		}
	}
	list, _, err := s.QueryIPEntries(IPEntryQuery{Subnet: "业务网", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	owners := map[string]map[string]interface{}{}
	for _, entry := range list {
		raw, err := json.Marshal(entry)
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		owners[entry.IP] = decoded
	}
	if owners["10.20.30.2"]["status"] != "在用" || owners["10.20.30.2"]["owner_type"] != "infrastructure" || owners["10.20.30.2"]["owner_name"] != "核心交换机 A" {
		t.Fatalf("基础设施占用未联动: %+v", owners["10.20.30.2"])
	}
	if owners["10.20.30.10"]["status"] != "在用" || owners["10.20.30.10"]["owner_type"] != "application" || owners["10.20.30.10"]["owner_name"] != "审判业务系统" {
		t.Fatalf("业务系统占用未联动: %+v", owners["10.20.30.10"])
	}
}

func TestAllocateIPToInfrastructureAndApplication(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	infrastructureID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "汇聚交换机", AssetCode: "SW-002", DeviceType: "switch"})
	if err != nil {
		t.Fatal(err)
	}
	serverID, err := s.CreateServerForProject(scope, &PhysicalServer{DeviceName: "应用节点"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	applicationID, err := s.CreateAppForProject(scope, &ServerApp{ServerID: serverID, AppName: "执行系统"})
	if err != nil {
		t.Fatal(err)
	}
	infraIP, _ := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "业务网", IP: "10.20.40.2", Status: "空闲"})
	appIP, _ := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "业务网", IP: "10.20.40.20", Status: "空闲"})

	if err := s.AllocateIPToOwnerForProject(scope, infraIP, "infrastructure", infrastructureID, "mgmt_ip", "管理地址"); err != nil {
		t.Fatal(err)
	}
	asset, _, err := s.GetCmdbAssetForProject(scope, infrastructureID)
	if err != nil || asset.MgmtIP != "10.20.40.2" {
		t.Fatalf("基础设施 IP 未同步: asset=%+v err=%v", asset, err)
	}
	entry, _ := s.GetIPEntryForProject(scope, infraIP)
	if entry.OwnerType != "infrastructure" || entry.OwnerID != infrastructureID || entry.Status != "在用" {
		t.Fatalf("基础设施占用关系未保存: %+v", entry)
	}

	if err := s.AllocateIPToOwnerForProject(scope, appIP, "application", applicationID, "ip", "应用地址"); err != nil {
		t.Fatal(err)
	}
	entry, _ = s.GetIPEntryForProject(scope, appIP)
	if entry.OwnerType != "application" || entry.OwnerID != applicationID || entry.OwnerName != "执行系统" || entry.Status != "在用" {
		t.Fatalf("应用占用关系未保存: %+v", entry)
	}
	if err := s.ReleaseIPForProject(scope, appIP); err != nil {
		t.Fatal(err)
	}
	entry, _ = s.GetIPEntryForProject(scope, appIP)
	if entry.OwnerType != "" || entry.OwnerID != 0 || entry.Status != "空闲" {
		t.Fatalf("释放后仍保留应用占用关系: %+v", entry)
	}
}

func TestDeleteIPEntryRejectsInfrastructureOwner(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name: "核心交换机", DeviceType: "switch", MgmtIP: "10.20.50.2",
	})
	if err != nil {
		t.Fatal(err)
	}
	ipID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "管理网", IP: "10.20.50.2", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteIPEntryForProject(scope, ipID, false); err == nil {
		t.Fatal("基础设施仍引用 IP 时不应允许直接删除")
	}
	entry, err := s.GetIPEntryForProject(scope, ipID)
	if err != nil || entry.OwnerType != "infrastructure" || entry.OwnerID != assetID {
		t.Fatalf("拒绝删除后占用关系应保持: entry=%+v err=%v", entry, err)
	}
}

func TestReleaseUnreferencedIPKeepsInfrastructureReference(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	if _, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{
		Name: "虚拟化节点", DeviceType: "server", BizIP: "10.20.60.10",
	}); err != nil {
		t.Fatal(err)
	}
	ipID, err := s.CreateIPEntryForProject(scope, &IPEntry{Subnet: "业务网", IP: "10.20.60.10", Status: "空闲"})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := releaseUnreferencedIPInTx(tx, scope.ProjectID, "10.20.60.10"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	entry, err := s.GetIPEntryForProject(scope, ipID)
	if err != nil || entry.Status != "在用" || entry.OwnerType != "infrastructure" {
		t.Fatalf("基础设施仍引用 IP 时不得释放: entry=%+v err=%v", entry, err)
	}
}

func TestIPVisualizationExpandsCIDRAndSummaryUsesCapacity(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "小网段", Category: "内网", Prefix: "192.0.2", CIDR: "192.0.2.0/29"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPEntry(&IPEntry{Subnet: "小网段", IP: "192.0.2.2", Status: "在用", Account: "占用人"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPEntry(&IPEntry{Subnet: "小网段", IP: "192.0.2.3", Status: "保留", Remark: "备用"}); err != nil {
		t.Fatal(err)
	}
	summary, err := s.IPPoolSummaryData()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 6 || summary.Used != 1 || summary.Reserved != 1 || summary.Free != 4 || summary.UsageRate != 16.7 {
		t.Fatalf("CIDR 容量统计错误: %+v", summary)
	}
	rows, total, err := s.VisualizeIPSubnet("小网段", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if total != 8 || len(rows) != 8 || rows[0].Status != "网络地址" || rows[0].IP != "192.0.2.0" || rows[2].Status != "在用" || rows[3].Status != "保留" || rows[7].Status != "广播地址" || rows[7].IP != "192.0.2.7" {
		t.Fatalf("CIDR 可视化结果错误: total=%d rows=%+v", total, rows)
	}
}

func TestIPSubnetSpecialAddressesCannotBeAllocated(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务网", CIDR: "10.20.30.0/29"}); err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"10.20.30.0", "10.20.30.7"} {
		if _, err := s.CreateIPEntry(&IPEntry{Subnet: "业务网", IP: ip, Status: "空闲"}); err == nil {
			t.Fatalf("%s 不得补录为可分配地址", ip)
		}
		if err := s.ImportIPEntriesForProject(ProjectScope{ProjectID: 1}, []IPEntry{{Subnet: "业务网", IP: ip}}); err == nil {
			t.Fatalf("%s 不得通过导入绕过限制", ip)
		}
	}
	legacy, err := s.db.Exec(`INSERT INTO ip_pool(project_id,subnet,ip,status) VALUES(1,'业务网','10.20.30.7','空闲')`)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := legacy.LastInsertId()
	if err := s.AllocateIP(id, "技术处", "张三", "", ""); err == nil {
		t.Fatal("历史广播地址不得分配")
	}
	if err := s.UpdateIPEntry(&IPEntry{ID: id, Subnet: "业务网", IP: "10.20.30.7", Status: "在用"}); err == nil {
		t.Fatal("更新接口不得把广播地址改为占用")
	}
}

func TestReservedIPCanAllocateToAssetDirectly(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务网", CIDR: "10.20.30.0/29"}); err != nil {
		t.Fatal(err)
	}
	assetID, err := s.CreateAsset(&Asset{AssetCode: "RESERVED-1", DeviceType: "台式电脑", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	ipID, err := s.CreateIPEntry(&IPEntry{Subnet: "业务网", IP: "10.20.30.2", Status: "保留", Remark: "预留给新设备"})
	if err != nil {
		t.Fatal(err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AllocateIPToOwnerForProject(scope, ipID, "terminal", assetID, "ip", "设备上线"); err != nil {
		t.Fatalf("预留地址应可直接分配: %v", err)
	}
	entry, err := s.GetIPEntry(ipID)
	if err != nil || entry.Status != "在用" || entry.OwnerType != "terminal" {
		t.Fatalf("预留转分配结果错误: entry=%+v err=%v", entry, err)
	}
}

func TestAssetWritesRejectDefinedSubnetSpecialAddresses(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "业务网", CIDR: "10.20.30.0/29"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAsset(&Asset{AssetCode: "BAD-IP", DeviceType: "台式电脑", IP: "10.20.30.0"}, "测试"); err == nil {
		t.Fatal("终端直录不得使用网络地址")
	}
	if err := s.ImportAssetsForProject(ProjectScope{ProjectID: 1}, []Asset{{AssetCode: "BAD-IMPORT", DeviceType: "台式电脑", IP: "10.20.30.7"}}); err == nil {
		t.Fatal("终端导入不得使用广播地址")
	}
	assetID, err := s.CreateAsset(&Asset{AssetCode: "GOOD-IP", DeviceType: "台式电脑", IP: "10.20.30.2"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateAsset(&Asset{ID: assetID, AssetCode: "GOOD-IP", DeviceType: "台式电脑", IP: "10.20.30.7"}, "测试"); err == nil {
		t.Fatal("终端编辑不得使用广播地址")
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "交换机", DeviceType: "switch", MgmtIP: "10.20.30.7"}); err == nil {
		t.Fatal("基础设施直录不得使用广播地址")
	}
}

func TestIPVisualizationAcceptsPrefixLengthCIDR(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "兼容网段", Prefix: "198.51.100", CIDR: "29"}); err != nil {
		t.Fatal(err)
	}
	rows, total, err := s.VisualizeIPSubnet("兼容网段", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if total != 8 || rows[0].Status != "网络地址" || rows[0].IP != "198.51.100.0" || rows[7].Status != "广播地址" || rows[7].IP != "198.51.100.7" {
		t.Fatalf("掩码位数格式未展开: total=%d rows=%+v", total, rows)
	}
}

func TestIPVisualizationKeepsPointToPointAndHostAddressesAssignable(t *testing.T) {
	s := newCmdbTestStore(t)
	for _, tc := range []struct {
		name string
		cidr string
		want []string
	}{
		{name: "点对点", cidr: "198.51.100.0/31", want: []string{"198.51.100.0", "198.51.100.1"}},
		{name: "单主机", cidr: "198.51.100.2/32", want: []string{"198.51.100.2"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.CreateIPSubnet(&IPSubnet{Name: tc.name, CIDR: tc.cidr}); err != nil {
				t.Fatal(err)
			}
			rows, total, err := s.VisualizeIPSubnet(tc.name, 1, 20)
			if err != nil {
				t.Fatal(err)
			}
			if total != len(tc.want) || len(rows) != len(tc.want) {
				t.Fatalf("地址数量错误: total=%d rows=%+v", total, rows)
			}
			for i, ip := range tc.want {
				if rows[i].IP != ip || rows[i].Status != "空闲" {
					t.Fatalf("%s 应为可分配地址: %+v", ip, rows[i])
				}
				if _, err := s.CreateIPEntry(&IPEntry{Subnet: tc.name, IP: ip, Status: "保留"}); err != nil {
					t.Fatalf("%s 应可预留: %v", ip, err)
				}
			}
		})
	}
}

func TestIPVisualizationKeepsHistoricalSpecialAddressReadOnly(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "旧网段", CIDR: "203.0.113.0/29"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO ip_pool(project_id,subnet,ip,status) VALUES(1,'旧网段','203.0.113.7','在用')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO assets(project_id,asset_code,device_type,ip) VALUES(1,'LEGACY-BROADCAST','台式电脑','203.0.113.7')`); err != nil {
		t.Fatal(err)
	}
	rows, total, err := s.VisualizeIPSubnet("旧网段", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if total != 8 || rows[7].Status != "广播地址" {
		t.Fatalf("历史占用不能覆盖广播地址状态: total=%d row=%+v", total, rows[7])
	}
	summary, err := s.IPPoolSummaryData()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Total != 6 || summary.Used != 0 || summary.Free != 6 {
		t.Fatalf("历史广播地址不得计入可分配容量: %+v", summary)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
