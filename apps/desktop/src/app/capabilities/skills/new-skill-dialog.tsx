import { type DragEvent, type FormEvent, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldHint } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SanitizedInput } from '@/components/ui/sanitized-input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { AlertTriangle, FileText, Upload, X } from '@/lib/icons'
import { queryClient } from '@/lib/query-client'
import { slug } from '@/lib/sanitize'
import { invalidateSlashCompletions } from '@/lib/slash-completion-cache'
import { cn } from '@/lib/utils'
import { createSkill, type ProfileScope } from '@/scout'
import { notify } from '@/store/notifications'

import {
  newSkillDocument,
  newSkillReady,
  readSkillFile,
  SKILL_CONTENT_LIMIT,
  SKILL_DESCRIPTION_LIMIT
} from './new-skill'
import { skillsQueryKey } from './skills-data'

/** Write the user's own skill into the Capabilities profile. Self-contained: it
 *  owns the create call and refreshes the skill list, callers only open/close it. */
export function NewSkillDialog({
  onClose,
  onCreated,
  open,
  profile
}: {
  onClose: () => void
  onCreated?: (name: string) => void
  open: boolean
  profile: ProfileScope
}) {
  const { t } = useI18n()
  const c = t.skills.create
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  // An uploaded SKILL.md: its file name (for the banner) and the frontmatter
  // keys beyond name/description, which are saved back verbatim.
  const [upload, setUpload] = useState<null | { extra: string; file: string; needsDescription: boolean }>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const draft = { description, extraFrontmatter: upload?.extra, instructions, name }
  const over = description.trim().length > SKILL_DESCRIPTION_LIMIT

  const reset = () => {
    setName('')
    setDescription('')
    setInstructions('')
    setUpload(null)
  }

  const loadFile = async (file: File) => {
    setError(null)

    try {
      const text = await file.text()

      if (text.length > SKILL_CONTENT_LIMIT) {
        setError(c.uploadTooLarge)

        return
      }

      const read = readSkillFile(text)

      if (!read.instructions) {
        setError(c.uploadFailed)

        return
      }

      setName(slug(read.name || file.name.replace(/\.md$/i, '').replace(/^skill$/i, '')))
      setDescription(read.description)
      setInstructions(read.instructions)
      // The file is the skill: only the name is asked for, plus the description
      // when the file has none the prompt index can use.
      setUpload({
        extra: read.extraFrontmatter ?? '',
        file: file.name,
        needsDescription: !read.description || read.description.length > SKILL_DESCRIPTION_LIMIT
      })
    } catch {
      setError(c.uploadFailed)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]

    if (file && !busy) {
      void loadFile(file)
    }
  }

  const close = () => {
    if (busy) {
      return
    }

    setError(null)
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()

    if (busy || !newSkillReady(draft)) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await createSkill(name, newSkillDocument(draft), profile)
      void queryClient.invalidateQueries({ queryKey: skillsQueryKey(profile), exact: true })
      invalidateSlashCompletions()
      notify({ kind: 'success', title: c.created(name), message: '' })
      reset()
      onCreated?.(name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : c.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && close()} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.blurb}</DialogDescription>
        </DialogHeader>

        <form
          className={cn(
            'grid gap-4 rounded-lg transition-shadow',
            dragging && 'shadow-[0_0_0_2px_var(--dt-midground)]'
          )}
          onDragLeave={() => setDragging(false)}
          onDragOver={event => {
            event.preventDefault()
            setDragging(true)
          }}
          onDrop={onDrop}
          onSubmit={event => void submit(event)}
        >
          <input
            accept=".md,text/markdown,text/plain"
            className="hidden"
            data-testid="new-skill-file"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''

              if (file) {
                void loadFile(file)
              }
            }}
            ref={fileInput}
            type="file"
          />
          {upload ? (
            <div className="flex items-center gap-2 rounded-md bg-(--ui-bg-tertiary) px-3 py-2 text-xs text-(--ui-text-secondary)">
              <FileText className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.uploaded(upload.file)}</span>
              <Button disabled={busy} onClick={reset} size="xs" type="button" variant="ghost">
                <X className="size-3" />
                {c.clearUpload}
              </Button>
            </div>
          ) : (
            <Button
              className="justify-self-start"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Upload className="size-3.5" />
              {c.upload}
            </Button>
          )}

          <Field htmlFor="new-skill-name" label={c.name}>
            <SanitizedInput
              autoFocus
              id="new-skill-name"
              maxLength={64}
              onValueChange={setName}
              placeholder={c.namePlaceholder}
              sanitize={slug}
              value={name}
            />
            <FieldHint>{c.nameHint}</FieldHint>
          </Field>

          {(!upload || upload.needsDescription) && (
          <Field htmlFor="new-skill-description" label={c.description}>
            <Input
              aria-invalid={over}
              id="new-skill-description"
              onChange={event => setDescription(event.target.value)}
              placeholder={c.descriptionPlaceholder}
              value={description}
            />
            <div className="flex items-start justify-between gap-3">
              <FieldHint error={over}>{c.descriptionHint}</FieldHint>
              <span
                className={cn(
                  'shrink-0 text-[0.66rem] tabular-nums',
                  over ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {description.trim().length}/{SKILL_DESCRIPTION_LIMIT}
              </span>
            </div>
          </Field>
          )}

          {!upload && (
          <Field htmlFor="new-skill-instructions" label={c.instructions}>
            <Textarea
              autoCapitalize="sentences"
              autoCorrect="on"
              className="min-h-40 resize-y"
              id="new-skill-instructions"
              onChange={event => setInstructions(event.target.value)}
              placeholder={c.instructionsPlaceholder}
              spellCheck
              value={instructions}
            />
          </Field>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button disabled={busy} onClick={close} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={busy || !newSkillReady(draft)} type="submit">
              {busy ? t.common.saving : c.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
