import React from 'react'
import { Form, Input, InputNumber, Select, DatePicker, Switch, Row, Col } from 'antd'
import dayjs from 'dayjs'

export default function DynamicFieldForm({ customFields = [], assetClass = 'all' }) {
  // 过滤适用的自定义字段
  const applicableFields = customFields.filter(
    (f) => f.asset_class === 'all' || f.asset_class === assetClass
  )

  if (applicableFields.length === 0) return null

  return (
    <Row gutter={16}>
      {applicableFields.map((field) => {
        const fieldPath = ['custom_fields', field.field_key]
        let inputComponent = <Input placeholder={`请输入${field.field_name}`} />

        if (field.field_type === 'number') {
          inputComponent = (
            <InputNumber
              style={{ width: '100%' }}
              placeholder={`请输入${field.field_name}`}
            />
          )
        } else if (field.field_type === 'select') {
          const opts = (field.options || []).map((o) => ({ value: o, label: o }))
          inputComponent = (
            <Select
              allowClear
              placeholder={`请选择${field.field_name}`}
              options={opts}
            />
          )
        } else if (field.field_type === 'date') {
          inputComponent = (
            <DatePicker
              style={{ width: '100%' }}
              placeholder={`请选择${field.field_name}`}
              format="YYYY-MM-DD"
            />
          )
        } else if (field.field_type === 'boolean') {
          return (
            <Col span={12} key={field.field_key}>
              <Form.Item
                name={fieldPath}
                label={field.field_name}
                valuePropName="checked"
              >
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            </Col>
          )
        }

        return (
          <Col span={12} key={field.field_key}>
            <Form.Item
              name={fieldPath}
              label={field.field_name}
              rules={[
                {
                  required: field.required === 1,
                  message: `请填写${field.field_name}`,
                },
              ]}
            >
              {inputComponent}
            </Form.Item>
          </Col>
        )
      })}
    </Row>
  )
}
