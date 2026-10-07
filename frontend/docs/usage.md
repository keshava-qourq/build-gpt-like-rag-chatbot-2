# Reading Room: usage, limitations and admin guide

This document matches the in-app Help screen (`src/screens/Help.tsx`). If the
two ever disagree, the in-app screen is what members actually see and this
file should be corrected to match it, not the other way round.

For installing, running or deploying the project, see
[`docs/setup.md`](../../docs/setup.md). Nothing about setup or deployment is
repeated here.

## What the assistant answers from

Reading Room answers questions using only the documents your team has
uploaded to the shared library. It never draws on anything the underlying
model learned elsewhere. If an answer is not supported by anything in the
library, you are told so plainly rather than given a confident guess: the
fixed reply is "I don't have information about that in the uploaded
documents," and no citations accompany it.

The document library is shared: everything anyone uploads is searchable by
every member once it reaches the Ready status. Conversations are private to
the person who had them; nobody else, including admins, can open another
person's chat history.

## Uploading documents

### Supported formats and the size limit

Five formats are accepted:

| Format | Extension | What gets read |
| --- | --- | --- |
| PDF | `.pdf` | The text of every page, with the page number kept for citation. Scanned or image-only PDFs are not read: there is no OCR in this release. |
| Word | `.docx` | Paragraph and table text, in document order. The older `.doc` format is not supported; save as `.docx` first. |
| Plain text | `.txt` | The whole file as written. |
| Markdown | `.md` | Headings, lists and fenced code blocks, structure preserved, and rendered back as formatted Markdown inside answers. |
| CSV | `.csv` | The header row and the data rows, with the row range kept for citation (for example, rows 120 to 148). |

Anything else, including `.pptx`, `.xlsx` and images, is refused before the
upload starts, so nothing part-formed is left in the library.

Every file, in every one of the five supported formats, is limited to 50MB.
Larger files are refused with a message naming the limit, and nothing is
stored.

### Multiple files at once

You can select or drag in as many files as you like in one go. Each becomes
its own document with its own status, and one file failing does not stop or
affect the others.

### Replacing an existing file

Uploading a file whose name already exists in the library asks you to
confirm that you want to replace the version that is there. Confirming
processes the new file; once it reaches Ready, the old version's passages and
embeddings are removed, so answers draw from the current version only. If the
replacement fails, the row shows Failed with a reason and tells you whether
the previous version is still in place.

## The four processing statuses

Every document sits in exactly one of four states:

| Status | What it means | Searchable? |
| --- | --- | --- |
| Queued | The file is stored and waiting its turn. Nothing has been read out of it yet. | No |
| Processing | Text is being extracted, split into passages and embedded for search. | No |
| Ready | Every passage is indexed. The document can be quoted and cited in answers. | **Yes** |
| Failed | Nothing usable came out of the file. The library shows the reason next to the row. | No |

Only **Ready** documents are retrievable and can be cited. Statuses update on
their own while you watch the library; you never need to sign out and back in
to see a document advance.

A document that fails most often does so for one of these reasons: no text
could be extracted (almost always a scanned or photographed document),
a password-protected file, an unreadable or corrupt file, or the embedding
provider being unavailable after retries. Reading the reason next to the row
tells you which applies, and re-uploading after fixing the file is always
safe.

## Asking a question and following up

Open a chat and type a question. The answer streams in as it is generated,
drawing only on passages retrieved from Ready documents. You can ask a
follow-up question in the same conversation and it is answered with the
earlier turns as context, so pronouns and references to what was just
discussed resolve correctly.

You can copy any answer's text, or regenerate the most recent answer to get
a fresh attempt at the same question; regenerate is only offered on the
latest turn, not on earlier ones in the thread. You can also stop an answer
while it is still streaming; the partial text stays in the thread marked as
stopped.

## Checking a citation

Every factual sentence in an answer carries a numbered marker, such as `[2]`,
once the answer has finished streaming. Markers number consecutively within
a single answer, and two claims drawn from the same passage share the same
number. The fixed "not in the uploaded documents" reply never carries
markers, because nothing was retrieved to support it.

To check a citation:

1. Click the numbered marker. A source panel opens beside the answer (as a
   full-width sheet on a narrow screen).
2. Read the document name, the page number or row range, and the passage
   exactly as it was retrieved and quoted.
3. Step between every source used by that answer without closing the panel.
4. Close the panel with Escape or the close button; the conversation stays
   where you left it.

The source panel also offers the original uploaded file, so you can read the
surrounding pages for yourself.

## Limitations

These are deliberate, not bugs:

- **The assistant answers only from uploaded documents, never from general
  knowledge.** If nothing in the library clears the relevance threshold, you
  get the fixed refusal and no model call produces an invented answer.
- **Scanned or image-only PDFs are not read.** There is no OCR in this
  release. Those files are marked Failed with a reason rather than quietly
  indexed as empty.
- **Only five formats are supported, each with a 50MB per-file limit**: PDF,
  DOCX, TXT, CSV and Markdown. Nothing else is accepted.
- **Documents are assumed to be English.** Other languages are still
  extracted and indexed, but no language-specific retrieval tuning has been
  done, so answer quality on non-English documents is not guaranteed.
- **Documents are shared with the whole team; conversations are private.**
  Every uploaded document becomes searchable by everyone once it is Ready.
  Your conversations are visible only to you, admins included.
- There is no way to limit a single conversation to chosen documents: every
  question searches the entire library of Ready documents.
- There is no automatic import from Drive, SharePoint or email. Documents
  arrive by manual upload only.

Reading Room has no pricing, plan, invoice or payment behaviour of any kind.
Access is controlled entirely by workspace membership, not by billing.

## For admins

### Inviting a member by email

There is no open sign-up; people reach the workspace by invitation only.

1. Open Members and choose Invite member.
2. Enter the email address and pick the role, member or admin.
3. They receive a single-use link and set their own password, which is only
   ever stored as a hash.
4. The link stops working once it has been used or once it expires (seven
   days after it was sent).

### Removing a member

Only admins can remove a member. Removing someone ends their sessions
immediately, so they cannot sign in again until restored. Documents they
uploaded stay in the shared library: content your team depends on does not
disappear when somebody leaves. Their past conversations are not visible to
anyone else, including admins, before or after removal.

### What each role can do

There are exactly two roles, member and admin:

| Capability | Member | Admin |
| --- | --- | --- |
| Upload documents to the shared library | Yes | Yes |
| Ask questions and open citations | Yes | Yes |
| Download any original file | Yes | Yes |
| Delete a document you uploaded yourself | Yes | Yes |
| Delete a document uploaded by someone else | No | Yes |
| Invite a colleague by email address | No | Yes |
| Remove a member from the workspace | No | Yes |
| Read another person's conversations | No | No |

An admin may delete any document in the workspace. A member may delete only
the documents they uploaded themselves; the delete action is not shown to
them for anyone else's upload, and a direct request to delete it is refused.
There is no per-document or per-folder sharing to configure beyond this.
