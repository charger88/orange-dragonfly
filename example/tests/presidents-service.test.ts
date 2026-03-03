import PresidentsService from '../services/presidents'

let service: PresidentsService

beforeEach(() => {
  service = new PresidentsService()
})

describe('PresidentsService', () => {
  describe('getList', () => {
    test('returns first 10 presidents by default', () => {
      const list = service.getList()
      expect(list).toHaveLength(10)
      expect(list[0]).toEqual({ id: 1, name: 'George Washington' })
      expect(list[9]).toEqual({ id: 10, name: 'John Tyler' })
    })

    test('returns presidents with offset and limit', () => {
      const list = service.getList(2, 3)
      expect(list).toHaveLength(3)
      expect(list[0]).toEqual({ id: 3, name: 'Thomas Jefferson' })
      expect(list[2]).toEqual({ id: 5, name: 'James Monroe' })
    })

    test('returns empty array for out-of-range offset', () => {
      const list = service.getList(1000, 10)
      expect(list).toEqual([])
    })

    test('returns remaining items when limit exceeds available', () => {
      const list = service.getList(40, 100)
      expect(list.length).toBeGreaterThan(0)
      expect(list.length).toBeLessThanOrEqual(100)
    })
  })

  describe('getById', () => {
    test('returns president by id', () => {
      const president = service.getById(1)
      expect(president).toEqual({ id: 1, name: 'George Washington' })
    })

    test('returns Abraham Lincoln by id 16', () => {
      const president = service.getById(16)
      expect(president).toEqual({ id: 16, name: 'Abraham Lincoln' })
    })

    test('returns null for non-existent id', () => {
      expect(service.getById(9999)).toBeNull()
    })
  })

  describe('create', () => {
    test('creates a new president with auto-incremented id', () => {
      const president = service.create('Test President')
      expect(president.name).toBe('Test President')
      expect(president.id).toBeGreaterThan(0)
    })

    test('created president is retrievable by id', () => {
      const created = service.create('New President')
      const found = service.getById(created.id)
      expect(found).toEqual(created)
    })

    test('successive creates produce incrementing ids', () => {
      const first = service.create('First')
      const second = service.create('Second')
      expect(second.id).toBe(first.id + 1)
    })
  })

  describe('deleteById', () => {
    test('deletes an existing president and returns true', () => {
      const result = service.deleteById(1)
      expect(result).toBe(true)
      expect(service.getById(1)).toBeNull()
    })

    test('returns false for non-existent id', () => {
      const result = service.deleteById(9999)
      expect(result).toBe(false)
    })
  })
})
