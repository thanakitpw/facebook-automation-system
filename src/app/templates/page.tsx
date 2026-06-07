import { createTemplate } from './actions'

export default function TemplatesPage() {
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Message Templates</h1>
      <form action={createTemplate} className="max-w-md space-y-3" encType="multipart/form-data">
        <input name="pageId" placeholder="page row id" className="w-full rounded border p-2" required />
        <select name="type" className="w-full rounded border p-2">
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="file">File</option>
          <option value="buttons">Buttons</option>
        </select>
        <textarea name="text" placeholder="Message text" className="w-full rounded border p-2" />
        <input name="file" type="file" className="w-full" />
        <textarea name="buttons" placeholder='Buttons JSON e.g. [{"title":"Open","url":"https://.."}]' className="w-full rounded border p-2" />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">Save template</button>
      </form>
    </main>
  )
}
