package internal

import (
	"net/http"
	"time"

	"czfy-assets/internal/store"
	"github.com/xuri/excelize/v2"
)

func (s *Server) handleExportCmdbWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope := requestProjectScope(r)
	q := r.URL.Query()
	query := store.CmdbWorkOrderQuery{
		Keyword: q.Get("keyword"), BizType: q.Get("biz_type"), Status: q.Get("status"), Result: q.Get("result"), Owner: q.Get("owner"), Maintainer: q.Get("maintainer"),
		OperationType: q.Get("operation_type"), Priority: q.Get("priority"), DateFrom: q.Get("date_from"), DateTo: q.Get("date_to"), AssetKeyword: q.Get("asset_keyword"), PageSize: 500,
	}
	var rows []store.CmdbWorkOrder
	for page := 1; ; page++ {
		query.Page = page
		batch, total, err := s.Store.QueryCmdbWorkOrdersForProject(scope, query)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		rows = append(rows, batch...)
		if len(rows) >= total {
			break
		}
		if len(batch) == 0 {
			writeErr(w, http.StatusInternalServerError, "工单导出分页结果不完整")
			return
		}
	}
	book := excelize.NewFile()
	defer book.Close()
	const sheet = "工单管理"
	book.SetSheetName("Sheet1", sheet)
	headers := []string{"工单号", "优先级", "维护主题", "维护类型", "维护状态", "计划维护时间", "实际时间", "维护结果", "负责人", "维护人员", "备注"}
	for index, header := range headers {
		cell, _ := excelize.CoordinatesToCellName(index+1, 1)
		_ = book.SetCellValue(sheet, cell, header)
	}
	for rowIndex, order := range rows {
		values := []interface{}{order.OrderNo, order.Priority, order.Subject, order.BizType, order.Status, order.PlanTime, order.ActualTime, order.Result, order.Owner, order.Maintainer, order.Remark}
		for columnIndex, value := range values {
			cell, _ := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+2)
			_ = book.SetCellValue(sheet, cell, value)
		}
	}
	file, err := book.WriteToBuffer()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="cmdb_work_orders_`+time.Now().Format("20060102_150405")+`.xlsx"`)
	_, _ = w.Write(file.Bytes())
}
