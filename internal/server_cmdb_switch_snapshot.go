package internal

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"czfy-assets/internal/store"
)

func (s *Server) handleGetCmdbSwitchSnapshot(w http.ResponseWriter, r *http.Request) {
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || assetID <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的资产 ID")
		return
	}
	item, err := s.Store.GetCmdbSwitchSnapshotForProject(requestProjectScope(r), assetID)
	if errors.Is(err, sql.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutCmdbSwitchSnapshot(w http.ResponseWriter, r *http.Request) {
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || assetID <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的资产 ID")
		return
	}
	var payload struct {
		Vendor   string          `json:"vendor"`
		Protocol string          `json:"protocol"`
		HostID   string          `json:"host_id"`
		ReadAt   string          `json:"read_at"`
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if err := decodeStrictJSON(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "请求字段无效: "+err.Error())
		return
	}
	item := &store.CmdbSwitchSnapshot{AssetID: assetID, Vendor: payload.Vendor, Protocol: payload.Protocol, HostID: payload.HostID, ReadAt: payload.ReadAt, SnapshotJSON: string(payload.Snapshot)}
	if err := s.Store.SaveCmdbSwitchSnapshotForProject(requestProjectScope(r), item); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "交换机配置快照已保存"})
}
