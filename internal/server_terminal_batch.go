package internal

import (
	"encoding/json"
	"net/http"
	"strings"

	"czfy-assets/internal/store"
)

func (s *Server) handleBatchTerminalAssets(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs      []int64                    `json:"ids"`
		Changes  store.TerminalAssetChanges `json:"changes"`
		Operator string                     `json:"operator"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeErr(w, 400, "请求体解析失败: "+err.Error())
		return
	}
	operator := strings.TrimSpace(body.Operator)
	if operator == "" {
		operator = "管理员"
	}
	n, err := s.Store.BatchUpdateTerminalAssetsForProject(requestProjectScope(r), body.IDs, body.Changes, operator)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"affected": n, "message": "批量更新成功"})
}
