package store

import (
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
