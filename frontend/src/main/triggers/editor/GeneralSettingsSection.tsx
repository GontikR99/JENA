import Col from 'react-bootstrap/Col'
import Form from 'react-bootstrap/Form'
import Row from 'react-bootstrap/Row'
import { Section } from './Section'
import type { TriggerEditorDraft } from './triggerEditorModel'

interface GeneralSettingsSectionProps {
  draft: TriggerEditorDraft
  onChange: (draft: TriggerEditorDraft) => void
}

export function GeneralSettingsSection({
  draft,
  onChange,
}: GeneralSettingsSectionProps) {
  return (
    <Section title="General Settings">
      <Form.Group as={Row} className="trigger-editor-row" controlId="trigger-name">
        <Form.Label column sm={3}>
          Trigger Name
        </Form.Label>
        <Col sm={9}>
          <Form.Control
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
            size="sm"
            type="text"
            value={draft.name}
          />
        </Col>
      </Form.Group>

      <Form.Group as={Row} className="trigger-editor-row" controlId="search-text">
        <Form.Label column sm={3}>
          Search Text
        </Form.Label>
        <Col sm={9}>
          <Form.Control
            onChange={(event) =>
              onChange({
                ...draft,
                match: {
                  ...draft.match,
                  text: event.currentTarget.value,
                },
              })
            }
            size="sm"
            type="text"
            value={draft.match.text}
          />
        </Col>
      </Form.Group>

      <Row className="trigger-editor-row">
        <Col sm={{ offset: 3, span: 9 }}>
          <div className="trigger-editor-inline-checks">
            <Form.Check
              checked={draft.match.isRegex}
              id="trigger-editor-use-regex"
              label="Use Regular Expressions"
              onChange={(event) =>
                onChange({
                  ...draft,
                  match: {
                    ...draft.match,
                    isRegex: event.currentTarget.checked,
                  },
                })
              }
              type="checkbox"
            />
            <Form.Check
              disabled
              id="trigger-editor-use-fast-check"
              label="Use Fast Check"
              type="checkbox"
            />
          </div>
        </Col>
      </Row>

      <Form.Group as={Row} className="trigger-editor-row" controlId="category">
        <Form.Label column sm={3}>
          Category
        </Form.Label>
        <Col sm={9}>
          <Form.Select
            onChange={(event) =>
              onChange({ ...draft, category: event.currentTarget.value })
            }
            size="sm"
            value={draft.category || 'Default'}
          >
            <option>Default</option>
            <option>Warnings</option>
            <option>Cures</option>
            <option>Debuffs</option>
          </Form.Select>
        </Col>
      </Form.Group>

      <Form.Group as={Row} className="trigger-editor-row" controlId="comments">
        <Form.Label column sm={3}>
          Comments
        </Form.Label>
        <Col sm={9}>
          <Form.Control
            as="textarea"
            onChange={(event) =>
              onChange({ ...draft, comments: event.currentTarget.value })
            }
            rows={2}
            size="sm"
            value={draft.comments}
          />
        </Col>
      </Form.Group>
    </Section>
  )
}
