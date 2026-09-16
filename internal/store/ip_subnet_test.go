package store

import "testing"

func insertIP(t *testing.T, s *Store, subnet, ip, status string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO ip_pool (subnet, ip, department, room, account, status, remark)
		VALUES (?,?,'','','',?,'')`, subnet, ip, status); err != nil {
		t.Fatalf("准备 IP 数据失败: %v", err)
	}
}

func TestSeedIPSubnetsFromPoolIsIdempotent(t *testing.T) {
	s := newCmdbTestStore(t)
	insertIP(t, s, "7段", "138.64.7.2", "在用")
	insertIP(t, s, "7段", "138.64.7.3", "空闲")
	insertIP(t, s, "外网", "191.162.17.1", "在用")

	added, err := s.SeedIPSubnetsFromPool()
	if err != nil {
		t.Fatalf("补建网段定义失败: %v", err)
	}
	if added != 2 {
		t.Fatalf("应为 2 个网段补建定义，实际 %d", added)
	}
	if again, err := s.SeedIPSubnetsFromPool(); err != nil {
		t.Fatalf("重复补建失败: %v", err)
	} else if again != 0 {
		t.Fatalf("重复补建应为 0，实际 %d", again)
	}

	list, err := s.ListIPSubnets()
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("应有 2 个网段，实际 %d", len(list))
	}
	for _, v := range list {
		if !v.Defined {
			t.Fatalf("补建后应标记为已定义: %+v", v)
		}
		if v.Prefix == "" || v.CIDR == "" {
			t.Fatalf("应自动推导前缀与 CIDR: %+v", v)
		}
		switch v.Name {
		case "7段":
			if v.Category != "专网" || v.Total != 2 || v.Used != 1 || v.Free != 1 {
				t.Fatalf("7段统计错误: %+v", v)
			}
		case "外网":
			if v.Category != "外网" {
				t.Fatalf("外网类别应为「外网」，实际 %s", v.Category)
			}
		}
	}
}

func TestIPSubnetListShowsUndefinedSubnets(t *testing.T) {
	s := newCmdbTestStore(t)
	insertIP(t, s, "9段", "138.64.9.2", "空闲")

	// 未补建定义时，也应能看到这个网段（Defined=false），不能被藏起来
	list, err := s.ListIPSubnets()
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if len(list) != 1 || list[0].Defined {
		t.Fatalf("未定义的网段也应出现在列表中且标记 Defined=false: %+v", list)
	}
}

func TestIPSubnetCreateUpdateDeleteWithRenameCascade(t *testing.T) {
	s := newCmdbTestStore(t)
	insertIP(t, s, "9段", "138.64.9.2", "在用")

	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "  "}); err == nil {
		t.Fatalf("空名称必须报错")
	}
	id, err := s.CreateIPSubnet(&IPSubnet{
		Name: "内网办公段", Category: "内网", Prefix: "10.10.20", CIDR: "10.10.20.0/24",
		Gateway: "10.10.20.1", VLAN: "100", Purpose: "内网办公终端",
	})
	if err != nil {
		t.Fatalf("新增网段失败: %v", err)
	}
	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "内网办公段"}); err == nil {
		t.Fatalf("同名网段必须报错")
	}

	// 改名不涉及 IP 数据时，不应影响其它网段
	got, _ := s.GetIPSubnet(id)
	got.Name = "内网办公网"
	if err := s.UpdateIPSubnet(got); err != nil {
		t.Fatalf("更新网段失败: %v", err)
	}
	if v, _ := s.GetIPSubnet(id); v.Name != "内网办公网" {
		t.Fatalf("改名未生效: %+v", v)
	}

	// 定义「9段」并改名，IP 数据必须级联跟着改
	sid, err := s.CreateIPSubnet(&IPSubnet{Name: "9段", Category: "专网", Prefix: "138.64.9"})
	if err != nil {
		t.Fatalf("新增网段失败: %v", err)
	}
	v9, _ := s.GetIPSubnet(sid)
	v9.Name = "专网9段"
	if err := s.UpdateIPSubnet(v9); err != nil {
		t.Fatalf("改名失败: %v", err)
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ip_pool WHERE subnet = '专网9段'`).Scan(&cnt); err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("改名应级联更新 ip_pool.subnet，实际匹配 %d 条", cnt)
	}
	if left, _ := s.db.Query(`SELECT COUNT(*) FROM ip_pool WHERE subnet = '9段'`); left != nil {
		var n int
		_ = left.Scan(&n)
		if n != 0 {
			t.Fatalf("旧网段名不应残留 IP 数据，实际 %d 条", n)
		}
		left.Close()
	}

	// 有 IP 的网段不允许删除
	if err := s.DeleteIPSubnet(sid); err == nil {
		t.Fatalf("网段下还有 IP 时必须拒绝删除")
	}
	// 空网段可以删除
	if err := s.DeleteIPSubnet(id); err != nil {
		t.Fatalf("空网段应可删除: %v", err)
	}
}

func TestIPPoolSummaryIncludesDefinedEmptySubnet(t *testing.T) {
	s := newCmdbTestStore(t)
	insertIP(t, s, "7段", "138.64.7.2", "在用")

	if _, err := s.CreateIPSubnet(&IPSubnet{
		Name: "内网办公段", Category: "内网", Prefix: "10.10.20", CIDR: "10.10.20.0/24",
	}); err != nil {
		t.Fatalf("新增网段失败: %v", err)
	}

	sum, err := s.IPPoolSummaryData()
	if err != nil {
		t.Fatalf("汇总失败: %v", err)
	}
	var found bool
	for _, sub := range sum.Subnets {
		if sub.Subnet == "内网办公段" {
			found = true
			if sub.Category != "内网" || sub.Total != 0 {
				t.Fatalf("已定义的空网段应出现在总览且统计为 0: %+v", sub)
			}
		}
		if sub.Subnet == "7段" && sub.Category != "专网" {
			t.Fatalf("7段类别应为专网，实际 %s", sub.Category)
		}
	}
	if !found {
		t.Fatalf("已定义但暂无 IP 的网段必须出现在总览中")
	}
}
