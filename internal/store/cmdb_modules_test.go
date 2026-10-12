package store

import (
	"testing"
	"time"
)

func TestWorkOrderMinutesSetOnlyWhenClosed(t *testing.T) {
	s := newCmdbTestStore(t)
	start := time.Now().Add(-5 * time.Minute).Format("2006-01-02 15:04:05")
	id, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "结算工时", PlanTime: start, WorkMinutes: 999, Result: "伪造结果", ActualTime: start})
	if err != nil {
		t.Fatal(err)
	}
	order, err := s.GetCmdbWorkOrder(id)
	if err != nil || order.WorkMinutes != 0 || order.Result != "" || order.ActualTime != "" {
		t.Fatalf("新建工单提前结算: %+v err=%v", order, err)
	}
	for _, status := range []string{"处理中", "已解决"} {
		order.Status = status
		order.WorkMinutes = 999
		if err := s.UpdateCmdbWorkOrder(order); err != nil {
			t.Fatal(err)
		}
		order, err = s.GetCmdbWorkOrder(id)
		if err != nil || order.WorkMinutes != 0 {
			t.Fatalf("%s 工单提前结算: %+v err=%v", status, order, err)
		}
	}
	order.Status = "已关闭"
	if err := s.UpdateCmdbWorkOrder(order); err != nil {
		t.Fatal(err)
	}
	order, err = s.GetCmdbWorkOrder(id)
	if err != nil || order.WorkMinutes < 5 || order.WorkMinutes > 6 {
		t.Fatalf("关闭工单未按发生到关闭时间结算: %+v err=%v", order, err)
	}
}

func TestCmdbWorkOrderCRUDAndFilter(t *testing.T) {
	s := newCmdbTestStore(t)

	id, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{
		Subject: "更换硬盘", BizType: "故障处理", Status: "新建", Priority: "高", Owner: "张三",
	})
	if err != nil {
		t.Fatalf("新增工单失败: %v", err)
	}
	if _, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: " "}); err == nil {
		t.Fatalf("空主题应当被拒绝")
	}
	if _, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "例行巡检", BizType: "日常巡检"}); err != nil {
		t.Fatalf("新增第二条工单失败: %v", err)
	}

	list, total, err := s.QueryCmdbWorkOrders(CmdbWorkOrderQuery{BizType: "故障处理", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("按类型过滤失败: %v", err)
	}
	if total != 1 || list[0].Subject != "更换硬盘" {
		t.Fatalf("按类型过滤结果错误: total=%d %+v", total, list)
	}

	// 占位符「所有类型」不应参与过滤
	_, total, err = s.QueryCmdbWorkOrders(CmdbWorkOrderQuery{BizType: "所有类型", Status: "所有状态", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("占位符过滤失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("占位符应视为不过滤，期望 2 条，实际 %d", total)
	}

	got, err := s.GetCmdbWorkOrder(id)
	if err != nil {
		t.Fatalf("读取工单失败: %v", err)
	}
	if got.OrderNo == "" {
		t.Fatalf("工单号应自动生成")
	}
	originalOrderNo := got.OrderNo
	got.Subject = "更换硬盘记录更新"
	got.OrderNo = "客户端不得修改"
	if err := s.UpdateCmdbWorkOrder(got); err != nil {
		t.Fatalf("更新工单失败: %v", err)
	}
	updatedOrder, err := s.GetCmdbWorkOrder(id)
	if err != nil || updatedOrder.OrderNo != originalOrderNo {
		t.Fatalf("编辑工单必须保留系统生成的工单号: order=%+v err=%v", updatedOrder, err)
	}
	if err := s.DeleteCmdbWorkOrder(id); err != nil {
		t.Fatalf("删除工单失败: %v", err)
	}
	if n, _ := s.CountCmdbWorkOrders(); n != 1 {
		t.Fatalf("删除后应剩 1 条，实际 %d", n)
	}
}

func TestCmdbWorkOrderBatchCompletion(t *testing.T) {
	s := newCmdbTestStore(t)
	first, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "批量结束一"})
	if err != nil {
		t.Fatalf("新增第一张工单失败: %v", err)
	}
	second, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "批量结束二"})
	if err != nil {
		t.Fatalf("新增第二张工单失败: %v", err)
	}
	for _, id := range []int64{first, second} {
		order, getErr := s.GetCmdbWorkOrder(id)
		if getErr != nil {
			t.Fatalf("读取待处理工单失败: %v", getErr)
		}
		order.Status = "处理中"
		if updateErr := s.UpdateCmdbWorkOrder(order); updateErr != nil {
			t.Fatalf("工单进入处理中失败: %v", updateErr)
		}
	}
	secondOrder, err := s.GetCmdbWorkOrder(second)
	if err != nil {
		t.Fatalf("读取待解决工单失败: %v", err)
	}
	secondOrder.Status = "已解决"
	if err := s.UpdateCmdbWorkOrder(secondOrder); err != nil {
		t.Fatalf("工单进入已解决失败: %v", err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取项目范围失败: %v", err)
	}
	if _, err := s.BatchUpdateCmdbWorkOrdersStatusForProject(scope, []int64{first, second}, "已关闭"); err == nil {
		t.Fatalf("包含处理中工单时不应允许批量关闭")
	}
	for _, id := range []int64{first, second} {
		order, getErr := s.GetCmdbWorkOrder(id)
		if getErr != nil {
			t.Fatalf("读取批量关闭失败后的工单: %v", getErr)
		}
		want := "已解决"
		if id == first {
			want = "处理中"
		}
		if order.Status != want {
			t.Fatalf("批量关闭失败后工单状态被部分修改: got=%q want=%q", order.Status, want)
		}
	}
	firstOrder, err := s.GetCmdbWorkOrder(first)
	if err != nil {
		t.Fatalf("读取待解决工单失败: %v", err)
	}
	firstOrder.Status = "已解决"
	if err := s.UpdateCmdbWorkOrder(firstOrder); err != nil {
		t.Fatalf("将处理中工单标记为已解决失败: %v", err)
	}
	updated, err := s.BatchUpdateCmdbWorkOrdersStatusForProject(scope, []int64{first, second, first}, "已关闭")
	if err != nil || updated != 2 {
		t.Fatalf("批量关闭应更新 2 张工单，updated=%d err=%v", updated, err)
	}
	for _, id := range []int64{first, second} {
		order, getErr := s.GetCmdbWorkOrder(id)
		if getErr != nil {
			t.Fatalf("读取批量结束工单失败: %v", getErr)
		}
		if order.Status != "已关闭" || order.ActualTime == "" {
			t.Fatalf("工单应进入已关闭并记录完成时间: %+v", order)
		}
		if order.WorkMinutes != 0 {
			t.Fatalf("未填写发生时间的工单不应凭空产生工时: %+v", order)
		}
	}
	if _, err := s.BatchUpdateCmdbWorkOrdersStatusForProject(scope, []int64{first, 999999}, "已关闭"); err == nil {
		t.Fatalf("包含不存在工单时不应返回成功")
	}
	if _, err := s.BatchUpdateCmdbWorkOrdersStatusForProject(scope, []int64{first}, "处理中"); err == nil {
		t.Fatalf("批量关闭不应接受非已关闭目标状态")
	}
}

func TestCmdbWorkOrderUpdateEnforcesSequentialTransitionsAndResolutionTime(t *testing.T) {
	s := newCmdbTestStore(t)
	if _, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "非法初始状态", Status: "已解决"}); err == nil {
		t.Fatalf("新建工单不能直接指定已解决状态")
	}
	id, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "按流程处理工单"})
	if err != nil {
		t.Fatalf("新增工单失败: %v", err)
	}
	order, err := s.GetCmdbWorkOrder(id)
	if err != nil {
		t.Fatalf("读取新建工单失败: %v", err)
	}
	if order.Status != "新建" {
		t.Fatalf("新建工单初始状态错误: %q", order.Status)
	}

	order.Status = "已解决"
	if err := s.UpdateCmdbWorkOrder(order); err == nil {
		t.Fatalf("新建工单不能跳过处理中直接标记已解决")
	}
	order, err = s.GetCmdbWorkOrder(id)
	if err != nil || order.Status != "新建" {
		t.Fatalf("非法状态跳转不得修改工单: order=%+v err=%v", order, err)
	}

	order.Status = "处理中"
	if err := s.UpdateCmdbWorkOrder(order); err != nil {
		t.Fatalf("新建工单进入处理中失败: %v", err)
	}
	order, err = s.GetCmdbWorkOrder(id)
	if err != nil {
		t.Fatalf("读取处理中工单失败: %v", err)
	}
	order.Status = "已解决"
	if err := s.UpdateCmdbWorkOrder(order); err != nil {
		t.Fatalf("处理中工单进入已解决失败: %v", err)
	}
	order, err = s.GetCmdbWorkOrder(id)
	if err != nil {
		t.Fatalf("读取已解决工单失败: %v", err)
	}
	if order.ActualTime == "" {
		t.Fatalf("进入已解决时必须自动补齐完成时间")
	}
	resolvedAt := order.ActualTime
	order.Status = "已关闭"
	if err := s.UpdateCmdbWorkOrder(order); err != nil {
		t.Fatalf("已解决工单进入已关闭失败: %v", err)
	}
	closed, err := s.GetCmdbWorkOrder(id)
	if err != nil || closed.Status != "已关闭" || closed.ActualTime != resolvedAt {
		t.Fatalf("关闭工单应保留解决时间: order=%+v err=%v", closed, err)
	}
}

func TestCmdbLegacyAssignedWorkOrderCanContinueToProcessing(t *testing.T) {
	s := newCmdbTestStore(t)
	id, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "兼容旧工单", Status: "新建"})
	if err != nil {
		t.Fatalf("新增测试工单失败: %v", err)
	}
	if _, err := s.db.Exec(`UPDATE cmdb_work_orders SET status='已分配' WHERE id=?`, id); err != nil {
		t.Fatalf("设置旧版工单状态失败: %v", err)
	}
	order, err := s.GetCmdbWorkOrder(id)
	if err != nil {
		t.Fatalf("读取旧版工单失败: %v", err)
	}
	order.Status = "处理中"
	if err := s.UpdateCmdbWorkOrder(order); err != nil {
		t.Fatalf("旧版已分配工单应能进入处理中: %v", err)
	}
}

// 同一秒内连续创建不能产生重复单号（回归：曾用秒级时间戳生成，产生过重复工单号）。
func TestCmdbAutoNumbersAreUnique(t *testing.T) {
	s := newCmdbTestStore(t)

	w1, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "A"})
	if err != nil {
		t.Fatalf("新增工单失败: %v", err)
	}
	w2, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "B"})
	if err != nil {
		t.Fatalf("新增工单失败: %v", err)
	}
	a, _ := s.GetCmdbWorkOrder(w1)
	b, _ := s.GetCmdbWorkOrder(w2)
	if a.OrderNo == "" || b.OrderNo == "" {
		t.Fatalf("工单号不能为空")
	}
	if a.OrderNo == b.OrderNo {
		t.Fatalf("同一秒创建的工单号不能重复，实际都是 %s", a.OrderNo)
	}

	i1, err := s.CreateCmdbInventoryTask(&CmdbInventoryTask{Name: "P1"})
	if err != nil {
		t.Fatalf("新增盘点任务失败: %v", err)
	}
	i2, err := s.CreateCmdbInventoryTask(&CmdbInventoryTask{Name: "P2"})
	if err != nil {
		t.Fatalf("新增盘点任务失败: %v", err)
	}
	list, _, err := s.QueryCmdbInventoryTasks("", "", 1, 10)
	if err != nil {
		t.Fatalf("查询盘点任务失败: %v", err)
	}
	seen := map[string]bool{}
	for _, item := range list {
		if item.TaskNo == "" {
			t.Fatalf("任务编号不能为空")
		}
		if seen[item.TaskNo] {
			t.Fatalf("任务编号重复: %s", item.TaskNo)
		}
		seen[item.TaskNo] = true
	}
	_ = i1
	_ = i2
}

func TestCmdbInventoryCRUD(t *testing.T) {
	s := newCmdbTestStore(t)

	if _, err := s.CreateCmdbInventoryTask(&CmdbInventoryTask{}); err == nil {
		t.Fatalf("空任务名应当被拒绝")
	}
	id, err := s.CreateCmdbInventoryTask(&CmdbInventoryTask{Name: "2026 年三季度盘点", Status: "执行中", Progress: 40, Abnormal: 2})
	if err != nil {
		t.Fatalf("新增盘点任务失败: %v", err)
	}
	list, total, err := s.QueryCmdbInventoryTasks("执行中", "", 1, 10)
	if err != nil {
		t.Fatalf("查询盘点任务失败: %v", err)
	}
	if total != 1 || list[0].Progress != 40 || list[0].TaskNo == "" {
		t.Fatalf("盘点任务查询结果错误: total=%d %+v", total, list)
	}
	list[0].Status = "已完成"
	list[0].Progress = 100
	if err := s.UpdateCmdbInventoryTask(&list[0]); err != nil {
		t.Fatalf("更新盘点任务失败: %v", err)
	}
	if _, total, _ := s.QueryCmdbInventoryTasks("已完成", "", 1, 10); total != 1 {
		t.Fatalf("状态更新后应能按新状态查到")
	}
	if err := s.DeleteCmdbInventoryTask(id); err != nil {
		t.Fatalf("删除盘点任务失败: %v", err)
	}
}

func TestCmdbCredentialCRUD(t *testing.T) {
	s := newCmdbTestStore(t)

	if _, err := s.CreateCmdbCredential(&CmdbCredential{Name: ""}); err == nil {
		t.Fatalf("空名称应当被拒绝")
	}
	assetID := insertCmdbAsset(t, s, CmdbAsset{Name: "核心交换机", AssetCode: "ZC-SW-1", Status: "在线"})
	if _, err := s.CreateCmdbCredential(&CmdbCredential{
		Name: "核心交换机 SSH", CredType: "SSH", Description: "只读账号", AssetID: assetID,
	}); err != nil {
		t.Fatalf("新增凭证失败: %v", err)
	}
	if _, err := s.CreateCmdbCredential(&CmdbCredential{Name: "SNMP 只读", CredType: "SNMPv2c"}); err != nil {
		t.Fatalf("新增凭证失败: %v", err)
	}

	list, total, err := s.QueryCmdbCredentials("SSH", "", 1, 10)
	if err != nil {
		t.Fatalf("按类型过滤失败: %v", err)
	}
	if total != 1 || list[0].AssetName != "核心交换机" {
		t.Fatalf("凭证关联资产名称应被带出: total=%d %+v", total, list)
	}

	list, total, err = s.QueryCmdbCredentials("全部类型", "", 1, 10)
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("应为 2 条，实际 %d", total)
	}
	if err := s.DeleteCmdbCredential(list[0].ID); err != nil {
		t.Fatalf("删除凭证失败: %v", err)
	}
}

func TestCmdbLabelsGenerateOrphanAndRepair(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A 设备", AssetCode: "ZC-A-1", Status: "在线"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "B 设备", AssetCode: "ZC-B-1", Status: "在线"})

	added, err := s.GenerateCmdbLabels("ZC")
	if err != nil {
		t.Fatalf("生成编码失败: %v", err)
	}
	if added != 2 {
		t.Fatalf("应为 2 台设备生成编码，实际 %d", added)
	}
	// 幂等：已有编码的资产不再重复生成
	if again, err := s.GenerateCmdbLabels("ZC"); err != nil {
		t.Fatalf("重复生成失败: %v", err)
	} else if again != 0 {
		t.Fatalf("重复生成应为 0，实际 %d", again)
	}

	if _, total, _ := s.QueryCmdbLabels("使用中", "", 1, 10); total != 2 {
		t.Fatalf("使用中编码应为 2，实际 %d", total)
	}

	// 生成编码之后新增一台资产：它还没有编码
	insertCmdbAsset(t, s, CmdbAsset{Name: "C 设备", AssetCode: "ZC-C-1", Status: "在线"})

	// 造一个「可修复」的孤儿：编码等于该资产的资产编号，但没有关联
	if _, err := s.db.Exec(`INSERT INTO cmdb_labels (code, asset_id, status, created_at, updated_at)
		VALUES ('ZC-C-1', 0, '使用中', '', '')`); err != nil {
		t.Fatalf("准备孤儿编码失败: %v", err)
	}
	// 再造一个彻底无法关联的孤儿
	if _, err := s.db.Exec(`INSERT INTO cmdb_labels (code, asset_id, status, created_at, updated_at)
		VALUES ('ZC-ORPHAN-X', 0, '使用中', '', '')`); err != nil {
		t.Fatalf("准备孤儿编码失败: %v", err)
	}

	if n, err := s.CountOrphanCmdbLabels(); err != nil {
		t.Fatalf("统计孤儿失败: %v", err)
	} else if n != 2 {
		t.Fatalf("孤儿应为 2，实际 %d", n)
	}

	handled, err := s.RepairOrphanCmdbLabels()
	if err != nil {
		t.Fatalf("修复孤儿失败: %v", err)
	}
	if handled != 2 {
		t.Fatalf("应处理 2 条孤儿，实际 %d", handled)
	}
	if n, _ := s.CountOrphanCmdbLabels(); n != 0 {
		t.Fatalf("修复后不应再有孤儿，实际 %d", n)
	}
	if _, total, _ := s.QueryCmdbLabels("已归档", "", 1, 10); total != 1 {
		t.Fatalf("无法关联的编码应转为已归档，实际 %d", total)
	}
}

func TestCmdbLabelPrintAndPrefix(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A", AssetCode: "ZC-A-9", Status: "在线"})
	if _, err := s.GenerateCmdbLabels("ZC"); err != nil {
		t.Fatalf("生成编码失败: %v", err)
	}
	list, _, _ := s.QueryCmdbLabels("使用中", "", 1, 10)
	if len(list) != 1 {
		t.Fatalf("应有 1 条编码")
	}
	n, err := s.MarkCmdbLabelsPrinted([]int64{list[0].ID}, "batch-1")
	if err != nil {
		t.Fatalf("标记打印失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应标记 1 条，实际 %d", n)
	}
	if err := s.SaveLabelCodePrefix("CZFZ"); err != nil {
		t.Fatalf("保存编码前缀失败: %v", err)
	}
	if p, _ := s.LabelCodePrefix(); p != "CZFZ" {
		t.Fatalf("编码前缀应为 CZFZ，实际 %s", p)
	}
}

func TestCmdbDashboardDataKeys(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "在线设备", AssetCode: "ZC-1", Status: "在线", Department: "立案庭"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "故障设备", AssetCode: "ZC-2", Status: "故障", Department: "执行局"})

	data, err := s.CmdbDashboardData()
	if err != nil {
		t.Fatalf("仪表盘聚合失败: %v", err)
	}
	for _, key := range []string{
		"total", "status_counts", "health_rate", "attention_count", "recent_assets",
		"geo_dist", "category_dist", "department_dist", "abnormal_devices",
		"expiring_count", "recent_work_orders", "work_order_total",
	} {
		if _, ok := data[key]; !ok {
			t.Fatalf("仪表盘缺少字段 %s", key)
		}
	}
	if data["total"].(int) != 2 {
		t.Fatalf("总数应为 2，实际 %v", data["total"])
	}
	if data["health_rate"].(float64) != 50 {
		t.Fatalf("健康率应为 50，实际 %v", data["health_rate"])
	}
	if len(data["abnormal_devices"].([]CmdbAsset)) != 1 {
		t.Fatalf("异常设备应为 1")
	}
}
