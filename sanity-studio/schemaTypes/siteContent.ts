import {defineField, defineType} from 'sanity'

const isSlugUnique = async (slug: string, context: any) => {
  const {document, getClient} = context
  const client = getClient({apiVersion: '2025-02-19'})

  const baseId = (document?._id || '').replace(/^drafts\./, '')
  const params = {
    slug,
    draft: `drafts.${baseId}`,
    published: baseId,
  }

  const query = `!defined(*[
    !(_id in [$draft, $published]) &&
    !(_id in path("versions.**")) &&
    slug.current == $slug
  ][0]._id)`

  return client.fetch(query, params)
}

export const siteContentType = defineType({
  name: 'siteContent',
  title: 'Site Content',
  type: 'document',
  fields: [
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        isUnique: isSlugUnique,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'hero',
      title: 'Hero',
      type: 'object',
      fields: [
        defineField({name: 'kicker', type: 'string'}),
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'lead', type: 'text'}),
        defineField({name: 'body', type: 'text'}),
        defineField({name: 'beliefTitle', type: 'string'}),
        defineField({
          name: 'beliefBullets',
          type: 'array',
          of: [{type: 'string'}],
        }),
        defineField({
          name: 'metrics',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                defineField({name: 'id', type: 'string'}),
                defineField({name: 'label', type: 'string'}),
              ],
            },
          ],
        }),
      ],
    }),
    defineField({
      name: 'mission',
      title: 'Mission',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'paragraphOne', type: 'text'}),
        defineField({name: 'paragraphTwo', type: 'text'}),
        defineField({
          name: 'pillars',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                defineField({name: 'title', type: 'string'}),
                defineField({name: 'description', type: 'text'}),
              ],
            },
          ],
        }),
      ],
    }),
    defineField({
      name: 'meaning',
      title: 'Meaning',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'meaningTitle', type: 'string'}),
        defineField({name: 'meaningBody', type: 'text'}),
        defineField({name: 'fitTitle', type: 'string'}),
        defineField({name: 'fitBody', type: 'text'}),
      ],
    }),
    defineField({
      name: 'experience',
      title: 'Experience',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({
          name: 'steps',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                defineField({name: 'step', type: 'string'}),
                defineField({name: 'description', type: 'text'}),
              ],
            },
          ],
        }),
      ],
    }),
    defineField({
      name: 'trust',
      title: 'Trust',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'intro', type: 'text'}),
        defineField({
          name: 'cards',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                defineField({name: 'title', type: 'string'}),
                defineField({name: 'body', type: 'text'}),
              ],
            },
          ],
        }),
      ],
    }),
    defineField({
      name: 'finalCta',
      title: 'Final CTA',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'body', type: 'text'}),
      ],
    }),
    defineField({
      name: 'support',
      title: 'Support',
      type: 'object',
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({name: 'intro', type: 'text'}),
        defineField({name: 'formTitle', type: 'string'}),
        defineField({name: 'formDescription', type: 'text'}),
        defineField({
          name: 'topics',
          type: 'array',
          of: [{type: 'string'}],
        }),
      ],
    }),
  ],
  preview: {
    select: {
      title: 'hero.title',
      subtitle: 'slug.current',
    },
    prepare(selection) {
      return {
        title: selection.title || 'Website content',
        subtitle: selection.subtitle || 'siteContent',
      }
    },
  },
})
